import type { DeepSeekHarnessAgentDto } from '@n8n/api-types';
import { isUniqueConstraintError } from '@n8n/db';
import { Container, Service } from '@n8n/di';
import { generateNanoId } from '@n8n/utils/generate-nano-id';
import type { ChunkType } from 'n8n-workflow';

import { ConflictError } from '@/errors/response-errors/conflict.error';

import {
	DeepSeekHarnessHomeService,
} from './deepseek-harness-home.service';
import { DeepSeekHarnessCliService } from './deepseek-harness-cli.service';
import { DeepSeekHarnessWebService } from './deepseek-harness-web.service';
import { DeepSeekHarnessRpcService } from './deepseek-harness-rpc.service';
import { DeepSeekHarnessAgent } from './entities/deepseek-harness-agent.entity';
import { DeepSeekHarnessAgentRepository } from './repositories/deepseek-harness-agent.repository';

const DEFAULT_AGENT_NAME = 'DeepSeek Harness';

@Service()
export class DeepSeekHarnessService {
	private readonly agentLocks = new Map<string, {
		lifecycleTail: Promise<void>;
		lifecyclePending: number;
		activeExecutions: number;
		executionDrain: Promise<void>;
		resolveExecutionDrain: () => void;
	}>();

	constructor(
		private readonly repository: DeepSeekHarnessAgentRepository,
		private readonly homeService: DeepSeekHarnessHomeService,
		private readonly cliService: DeepSeekHarnessCliService,
		private readonly webService: DeepSeekHarnessWebService,
	) {}

	private getAgentLock(id: string, projectId: string) {
		const key = `${projectId}:${id}`;
		const existing = this.agentLocks.get(key);
		if (existing) return { key, lock: existing };

		let resolveExecutionDrain!: () => void;
		const lock = {
			lifecycleTail: Promise.resolve(),
			lifecyclePending: 0,
			activeExecutions: 0,
			executionDrain: Promise.resolve(),
			resolveExecutionDrain,
		};
		this.agentLocks.set(key, lock);
		return { key, lock };
	}

	private async withAgentLifecycleLock<T>(
		id: string,
		projectId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const { key, lock } = this.getAgentLock(id, projectId);
		lock.lifecyclePending++;
		const current = lock.lifecycleTail
			.catch(() => undefined)
			.then(async () => {
				await lock.executionDrain;
				lock.lifecyclePending--;
				return await operation();
			});
		lock.lifecycleTail = current.then(() => undefined, () => undefined);
		try {
			return await current;
		} finally {
			if (lock.lifecyclePending === 0 && lock.activeExecutions === 0) this.agentLocks.delete(key);
		}
	}

	private async withAgentExecution<T>(
		id: string,
		projectId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const { key, lock } = this.getAgentLock(id, projectId);
		if (lock.lifecyclePending > 0) await lock.lifecycleTail;
		if (lock.activeExecutions === 0) {
			lock.executionDrain = new Promise<void>((resolve) => {
				lock.resolveExecutionDrain = resolve;
			});
		}
		lock.activeExecutions++;
		try {
			return await operation();
		} finally {
			lock.activeExecutions--;
			if (lock.activeExecutions === 0) lock.resolveExecutionDrain();
			if (lock.lifecyclePending === 0 && lock.activeExecutions === 0) this.agentLocks.delete(key);
		}
	}

	async executeForWorkflow(
		agentId: string,
		projectId: string,
		message: string,
		sessionId: string,
		allowUnpublished = false,
		sendResponseChunk?: (type: ChunkType, content?: string) => Promise<void>,
		workspaceId?: string,
	) {
		return await this.withAgentExecution(agentId, projectId, async () =>
			await Container.get(DeepSeekHarnessRpcService).execute(
				agentId,
				projectId,
				message,
				sessionId,
				{ allowUnpublished, sendResponseChunk, workspaceId },
			),
		);
	}

	async listWorkspacesForProject(id: string, projectId: string) {
		const agent = await this.repository.findByIdAndProjectId(id, projectId);
		if (!agent?.userName) return [];
		return await this.homeService.listWorkspaces(agent.userName, agent.name, agent.id);
	}

	async startStudioForProject(agentId: string, projectId: string): Promise<{ url: string }> {
		return await this.withAgentLifecycleLock(agentId, projectId, async () =>
			await this.webService.startForAgent(agentId, projectId),
		);
	}

	async publishForProject(id: string, projectId: string): Promise<DeepSeekHarnessAgentDto | null> {
		return await this.withAgentLifecycleLock(id, projectId, async () => {
			const agent = await this.repository.findByIdAndProjectId(id, projectId);
			if (!agent) return null;

			await this.webService.startForAgent(id, projectId);
			try {
				agent.published = true;
				return this.toDto(await this.repository.save(agent));
			} catch (error) {
				await this.webService.stopForAgent(id, projectId);
				throw error;
			}
		});
	}

	async unpublishForProject(
		id: string,
		projectId: string,
	): Promise<DeepSeekHarnessAgentDto | null> {
		return await this.withAgentLifecycleLock(id, projectId, async () => {
			const agent = await this.repository.findByIdAndProjectId(id, projectId);
			if (!agent) return null;

			agent.published = false;
			const saved = await this.repository.save(agent);
			try {
				await this.webService.stopForAgent(id, projectId);
				return this.toDto(saved);
			} catch (error) {
				agent.published = true;
				await this.repository.save(agent);
				throw error;
			}
		});
	}

	async resumePublishedAgents(): Promise<void> {
		const agents = await this.repository.findPublished();
		const results = await Promise.allSettled(
			agents.map(async (agent) => await this.webService.startForAgent(agent.id, agent.projectId)),
		);
		const failures = results.filter(
			(result): result is PromiseRejectedResult => result.status === 'rejected',
		);
		if (failures.length > 0) {
			throw new AggregateError(
				failures.map(({ reason }) => reason),
				`Failed to resume ${failures.length} published DeepSeek Harness agent(s)`,
			);
		}
	}

	async createForProject(userName: string, projectId: string): Promise<DeepSeekHarnessAgentDto> {
		for (let attempt = 0; attempt < 3; attempt++) {
			const normalizedName = await this.getUniqueName(DEFAULT_AGENT_NAME);
			const agent = this.repository.create({
				id: generateNanoId(),
				projectId,
				name: normalizedName,
				userName,
				status: 'created',
			});

			const home = await this.homeService.createHome(userName, normalizedName, agent.id);
			try {
				await this.homeService.createDefaultWorkspace(userName, normalizedName, agent.id);
				await this.cliService.initializeProfile(home);
				const saved = await this.repository.save(agent);
				return this.toDto(saved);
			} catch (error) {
				await this.homeService.removeHome(userName, normalizedName, agent.id);
				if (isUniqueConstraintError(error) && attempt < 2) continue;
				if (isUniqueConstraintError(error)) {
					throw new ConflictError(
						`A DeepSeek Harness agent named "${normalizedName}" already exists`,
					);
				}
				throw error;
			}
		}

		throw new ConflictError('Could not allocate a unique DeepSeek Harness agent name');
	}

	private async getUniqueName(requestedName: string): Promise<string> {
		const found = await this.repository.findStartingWith(requestedName);

		const suffixes = found.flatMap(({ name }) => {
			if (name === requestedName) return [0];
			const prefix = `${requestedName} `;
			if (!name.startsWith(prefix)) return [];
			const suffix = name.slice(prefix.length);
			const suffixNumber = Number(suffix);
			return suffix &&
				Number.isInteger(suffixNumber) &&
				suffixNumber > 0 &&
				String(suffixNumber) === suffix
				? [suffixNumber]
				: [];
		});
		if (suffixes.length === 0) return requestedName;

		const maxSuffix = Math.max(...suffixes, 1);

		return `${requestedName} ${maxSuffix + 1}`;
	}

	async listForProject(projectId: string): Promise<DeepSeekHarnessAgentDto[]> {
		return (await this.repository.findByProjectId(projectId)).map((agent) => this.toDto(agent));
	}

	async getForProject(id: string, projectId: string): Promise<DeepSeekHarnessAgentDto | null> {
		const agent = await this.repository.findByIdAndProjectId(id, projectId);
		return agent ? this.toDto(agent) : null;
	}

	async updateForProject(
		id: string,
		projectId: string,
		name: string,
	): Promise<DeepSeekHarnessAgentDto | null> {
		return await this.withAgentLifecycleLock(id, projectId, async () => {
		const agent = await this.repository.findByIdAndProjectId(id, projectId);
		if (!agent) return null;

		const newName = name.trim();
		if (!newName) throw new Error('DeepSeek Harness agent name cannot be empty');
		if (newName === agent.name) return this.toDto(agent);
		const oldName = agent.name;
		const shouldRestart =
			agent.published || agent.runtimeStatus === 'running' || agent.runtimeStatus === 'starting';
		let stopped = false;
		let renamed = false;
		let saved = false;
		let migrated = false;

		try {
			if (agent.userName) {
				await this.webService.stopForAgent(id, projectId);
				stopped = true;
				await this.homeService.renameHome(agent.userName, oldName, newName, agent.id);
				renamed = true;
				await this.homeService.migrateWorkspacePaths(
					this.homeService.getHome(agent.userName, oldName, agent.id),
					this.homeService.getHome(agent.userName, newName, agent.id),
					agent.id,
				);
				migrated = true;
			}

			agent.name = newName;
			const persisted = await this.repository.save(agent);
			saved = true;
			if (agent.userName && shouldRestart) {
				await this.webService.startForAgent(id, projectId);
			}
			return this.toDto(persisted);
		} catch (error) {
			const rollbackErrors: unknown[] = [];
			if (saved) {
				agent.name = oldName;
				await this.repository.save(agent).catch((rollbackError: unknown) => {
					rollbackErrors.push(rollbackError);
				});
			}
			if (agent.userName && migrated) {
				await this.homeService
					.migrateWorkspacePaths(
						this.homeService.getHome(agent.userName, newName, agent.id),
						this.homeService.getHome(agent.userName, oldName, agent.id),
						agent.id,
					)
					.catch((rollbackError: unknown) => {
						rollbackErrors.push(rollbackError);
					});
			}
			if (agent.userName && renamed) {
				await this.homeService
					.renameHome(agent.userName, newName, oldName, agent.id)
					.catch((rollbackError: unknown) => {
						rollbackErrors.push(rollbackError);
					});
			}
			if (agent.userName && stopped && shouldRestart) {
				await this.webService.startForAgent(id, projectId).catch(() => undefined);
			}
			if (isUniqueConstraintError(error)) {
				throw new ConflictError(`A DeepSeek Harness agent named "${newName}" already exists`);
			}
			if (rollbackErrors.length > 0) {
				const details = rollbackErrors
					.map((rollbackError) => (rollbackError instanceof Error ? rollbackError.message : String(rollbackError)))
					.join('; ');
				throw new Error(`DeepSeek Harness rename failed and rollback was incomplete: ${details}`, {
					cause: error,
				});
			}
			throw error;
		}
		});
	}

	async deleteForProject(id: string, projectId: string): Promise<boolean> {
		return await this.withAgentLifecycleLock(id, projectId, async () => {
			const agent = await this.repository.findByIdAndProjectId(id, projectId);
			if (!agent) return false;

			await this.webService.stopForAgent(id, projectId);
			const staged = agent.userName
				? await this.homeService.stageHomeForDeletion(agent.userName, agent.name, agent.id)
				: await this.homeService.stageLegacyHomeForDeletion(agent.id);
			let deleted: boolean;
			try {
				deleted = await this.repository.deleteByIdAndProjectId(id, projectId);
			} catch (error) {
				await this.restoreStagedHomesOrThrow(staged, error);
				throw error;
			}
			if (!deleted) {
				await this.restoreStagedHomesOrThrow(
					staged,
					new Error('DeepSeek Harness agent was not deleted'),
				);
				return false;
			}
			try {
				await this.homeService.removeStagedHomes(staged);
			} catch (error) {
				throw new Error(
					'DeepSeek Harness agent was deleted, but its staged home could not be removed',
					{ cause: error },
				);
			}
			return true;
		});
	}

	private async restoreStagedHomesOrThrow(
		staged: Awaited<ReturnType<DeepSeekHarnessHomeService['stageHomeForDeletion']>>,
		cause: unknown,
	): Promise<void> {
		try {
			await this.homeService.restoreStagedHomes(staged);
		} catch (rollbackError) {
			throw new Error('DeepSeek Harness delete failed and rollback was incomplete', {
				cause: new AggregateError([cause, rollbackError]),
			});
		}
	}

	private toDto(agent: DeepSeekHarnessAgent): DeepSeekHarnessAgentDto {
		return {
			id: agent.id,
			projectId: agent.projectId,
			name: agent.name,
			status: agent.status,
			published: agent.published ?? false,
			runtimeStatus: agent.runtimeStatus ?? 'stopped',
			runtimePort: agent.runtimePort ?? null,
			runtimeUrl: null,
			runtimeError: agent.runtimeError ?? null,
			createdAt: agent.createdAt,
			updatedAt: agent.updatedAt,
		};
	}
}
