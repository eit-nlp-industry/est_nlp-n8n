import type { DeepSeekHarnessAgentDto } from '@n8n/api-types';
import { isUniqueConstraintError } from '@n8n/db';
import { Service } from '@n8n/di';
import { generateNanoId } from '@n8n/utils/generate-nano-id';

import { ConflictError } from '@/errors/response-errors/conflict.error';

import { DeepSeekHarnessHomeService } from './deepseek-harness-home.service';
import { DeepSeekHarnessAgent } from './entities/deepseek-harness-agent.entity';
import { DeepSeekHarnessAgentRepository } from './repositories/deepseek-harness-agent.repository';

const DEFAULT_AGENT_NAME = 'DeepSeek Harness';

@Service()
export class DeepSeekHarnessService {
	constructor(
		private readonly repository: DeepSeekHarnessAgentRepository,
		private readonly homeService: DeepSeekHarnessHomeService,
	) {}

	async createForProject(userName: string, projectId: string): Promise<DeepSeekHarnessAgentDto> {
		const normalizedName = await this.getUniqueName(DEFAULT_AGENT_NAME);

		const agent = this.repository.create({
			id: generateNanoId(),
			projectId,
			name: normalizedName,
			userName,
			status: 'created',
		});

		await this.homeService.createHome(userName, normalizedName, agent.id);
		try {
			const saved = await this.repository.save(agent);
			return this.toDto(saved);
		} catch (error) {
			await this.homeService.removeHome(userName, normalizedName, agent.id);
			if (isUniqueConstraintError(error)) {
				throw new ConflictError(`A DeepSeek Harness agent named "${normalizedName}" already exists`);
			}
			throw error;
		}
	}

	private async getUniqueName(requestedName: string): Promise<string> {
		const found = await this.repository.findStartingWith(requestedName);

		if (found.length === 0) return requestedName;
		if (found.length === 1) return `${requestedName} 2`;

		const maxSuffix = found.reduce((max, { name }) => {
			const [, strSuffix] = name.split(`${requestedName} `);
			const numSuffix = parseInt(strSuffix, 10);
			return Number.isNaN(numSuffix) ? max : Math.max(max, numSuffix);
		}, 2);

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
		const agent = await this.repository.findByIdAndProjectId(id, projectId);
		if (!agent) return null;

		const newName = name.trim();
		if (!newName) throw new Error('DeepSeek Harness agent name cannot be empty');
		if (newName === agent.name) return this.toDto(agent);
		const oldName = agent.name;

		if (agent.userName) {
			await this.homeService.renameHome(agent.userName, oldName, newName, agent.id);
		}
		try {
			agent.name = newName;
			const saved = await this.repository.save(agent);
			return this.toDto(saved);
		} catch (error) {
			if (agent.userName) {
				await this.homeService.renameHome(agent.userName, newName, oldName, agent.id);
			}
			if (isUniqueConstraintError(error)) {
				throw new ConflictError(`A DeepSeek Harness agent named "${newName}" already exists`);
			}
			throw error;
		}
	}

	async deleteForProject(id: string, projectId: string): Promise<boolean> {
		const agent = await this.repository.findByIdAndProjectId(id, projectId);
		if (!agent) return false;

		const deleted = await this.repository.deleteByIdAndProjectId(id, projectId);
		if (deleted) {
			if (agent.userName) {
				await this.homeService.removeHome(agent.userName, agent.name, agent.id);
			} else {
				await this.homeService.removeLegacyHome(agent.id);
			}
		}
		return deleted;
	}

	private toDto(agent: DeepSeekHarnessAgent): DeepSeekHarnessAgentDto {
		return {
			id: agent.id,
			projectId: agent.projectId,
			name: agent.name,
			status: agent.status,
			createdAt: agent.createdAt,
			updatedAt: agent.updatedAt,
		};
	}
}
