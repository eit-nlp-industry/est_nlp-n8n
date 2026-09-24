import { DeepSeekHarnessConfig, GlobalConfig } from '@n8n/config';
import { Service } from '@n8n/di';
import { OnShutdown } from '@n8n/decorators';
import { sanitizeErrorDetail } from '@n8n/utils/redaction/sanitize-error-detail';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { join } from 'node:path';

import { NotFoundError } from '@/errors/response-errors/not-found.error';

import {
	DEFAULT_WORKSPACE_NAME,
	DeepSeekHarnessHomeService,
} from './deepseek-harness-home.service';
import { DeepSeekHarnessCliService } from './deepseek-harness-cli.service';
import { DeepSeekHarnessAgentRepository } from './repositories/deepseek-harness-agent.repository';

const STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;
const STARTUP_OUTPUT_LIMIT = 4_096;
const WEB_URL_PATTERN = /dsh web:\s+(https?:\/\/\S+)/;

type SpawnProcess = typeof spawn;
type Fetch = typeof fetch;
type WebRuntime = { url: string; workspaceId: string };

export function appendOutputTail(current: string, chunk: Buffer | string): string {
	return `${current}${chunk.toString()}`.slice(-STARTUP_OUTPUT_LIMIT);
}

export function getPublicHost(config: Pick<GlobalConfig, 'editorBaseUrl' | 'host'>): string {
	const editorBaseUrl = config.editorBaseUrl?.replace(/^["]+|["]+$/g, '');
	return editorBaseUrl ? new URL(editorBaseUrl).hostname : config.host;
}

export function getWebProcessInvocation(
	harnessPath: string,
	profile: string,
	nodePath: string = process.execPath,
	trustedHost?: string,
): { command: string; args: string[] } {
	const normalizedTrustedHost = trustedHost?.trim();
	return {
		command: nodePath,
		args: [
			join(harnessPath, 'apps', 'cli', 'lib', 'bin.js'),
			'--profile',
			profile,
			'--no-open',
			'--port',
			'0',
			...(normalizedTrustedHost ? ['--trusted-host', normalizedTrustedHost] : []),
		],
	};
}

@Service()
export class DeepSeekHarnessWebService {
	private readonly processes = new Map<string, { child: ChildProcess } & WebRuntime>();
	private readonly starting = new Map<string, Promise<WebRuntime>>();
	private readonly children = new Set<ChildProcess>();
	private readonly childAgents = new Map<ChildProcess, string>();

	constructor(
		private readonly repository: DeepSeekHarnessAgentRepository,
		private readonly homeService: DeepSeekHarnessHomeService,
		private readonly cliService: DeepSeekHarnessCliService,
		private readonly config: DeepSeekHarnessConfig,
		private readonly globalConfig: GlobalConfig,
		private readonly spawnProcess: SpawnProcess = spawn,
		private readonly fetchFn: Fetch = fetch,
	) {}

	/** Origin of a live Studio process, or null when none is running. */
	getRunningOrigin(projectId: string, agentId: string): string | null {
		const running = this.processes.get(`${projectId}:${agentId}`);
		if (!running || running.child.killed) return null;
		return new URL(running.url).origin;
	}

	async startForAgent(agentId: string, projectId: string): Promise<WebRuntime> {
		const key = `${projectId}:${agentId}`;
		const running = this.processes.get(key);
		if (running && !running.child.killed)
			return { url: running.url, workspaceId: running.workspaceId };

		const starting = this.starting.get(key);
		if (starting) return await starting;

		const promise = this.start(key, agentId, projectId);
		this.starting.set(key, promise);
		try {
			return await promise;
		} finally {
			this.starting.delete(key);
		}
	}

	async stopForAgent(agentId: string, projectId: string): Promise<void> {
		const key = `${projectId}:${agentId}`;
		const starting = this.starting.get(key);
		if (starting && !this.processes.has(key)) {
			await starting.catch(() => undefined);
		}

		const running = this.processes.get(key);
		if (!running) return;

		this.processes.delete(key);
		this.children.delete(running.child);
		this.childAgents.delete(running.child);
		const exitPromise = this.waitForExit(running.child);
		running.child.kill();
		await exitPromise;
		await this.repository.updateRuntimeState(agentId, {
			status: 'stopped',
			pid: null,
			port: null,
			url: null,
			error: null,
		});
	}

	private async waitForExit(child: ChildProcess): Promise<void> {
		if (child.exitCode !== null || child.signalCode !== null) return;

		await new Promise<void>((resolve) => {
			const timeout = setTimeout(resolve, STOP_TIMEOUT_MS);
			const done = () => {
				clearTimeout(timeout);
				resolve();
			};
			child.once('exit', done);
			child.once('error', done);
		});
	}

	private async start(key: string, agentId: string, projectId: string): Promise<WebRuntime> {
		const agent = await this.repository.findByIdAndProjectId(agentId, projectId);
		if (!agent) throw new NotFoundError(`DeepSeek Harness agent "${agentId}" not found`);
		if (!agent.userName) throw new Error(`DeepSeek Harness agent "${agentId}" has no user`);

		const harnessPath = this.config.path.trim();
		if (!harnessPath) throw new Error('N8N_DEEPSEEK_HARNESS_PATH is not configured');

		const profile = this.config.profile.trim();
		if (!profile) throw new Error('N8N_DEEPSEEK_HARNESS_PROFILE cannot be empty');

		const home = this.homeService.getHome(agent.userName, agent.name, agent.id);
		await this.cliService.ensureWorkspaceDirectory(home, profile);
		const registeredWorkspaces =
			typeof this.homeService.listWorkspaces === 'function'
				? await this.homeService.listWorkspaces(agent.userName, agent.name, agent.id)
				: [];
		const registeredDefault = registeredWorkspaces.find(
			(workspace) =>
				workspace.name === DEFAULT_WORKSPACE_NAME && workspace.id !== DEFAULT_WORKSPACE_NAME,
		);
		const workspacePath = registeredDefault
			? undefined
			: await this.homeService.createDefaultWorkspace(agent.userName, agent.name, agent.id);
		const nodePath = this.config.nodePath?.trim() || process.execPath;
		const invocation = getWebProcessInvocation(
			harnessPath,
			profile,
			nodePath,
			getPublicHost(this.globalConfig),
		);
		await this.repository.updateRuntimeState(agentId, {
			status: 'starting',
			pid: null,
			port: null,
			url: null,
			error: null,
		});
		const child = this.spawnProcess(invocation.command, invocation.args, {
			cwd: harnessPath,
			env: { ...process.env, DSH_HOME: home },
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		this.children.add(child);
		this.childAgents.set(child, agentId);

		return await new Promise((resolve, reject) => {
			let output = '';
			let stderr = '';
			let settled = false;
			let startupHandled = false;
			const timeout = setTimeout(() => {
				if (settled) return;
				fail(new Error('Timed out waiting for DeepSeek Harness Web to start'));
			}, STARTUP_TIMEOUT_MS);

			const fail = (error: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				void this.repository
					.updateRuntimeState(agentId, {
						status: 'error',
						pid: null,
						port: null,
						url: null,
						error: error.message,
					})
					.catch(() => {});
				this.children.delete(child);
				this.childAgents.delete(child);
				child.kill();
				reject(error);
			};

			const collectStderr = (chunk: Buffer | string) => {
				stderr = appendOutputTail(stderr, chunk);
			};
			const inspectStdout = async (chunk: Buffer | string) => {
				output = appendOutputTail(output, chunk);
				const match = output.match(WEB_URL_PATTERN);
				if (!match || settled || startupHandled) return;
				startupHandled = true;
				child.stdout?.off('data', inspectStdout);
				child.stderr?.off('data', collectStderr);

				try {
					const workspaceId =
						registeredDefault?.id ??
						(await this.registerDefaultWorkspace(match[1], workspacePath!));
					const entry = { child, url: match[1], workspaceId };
					await this.repository.updateRuntimeState(agentId, {
						status: 'running',
						pid: child.pid ?? null,
						port: Number(new URL(entry.url).port) || null,
						url: null,
						error: null,
					});
					settled = true;
					clearTimeout(timeout);
					this.processes.set(key, entry);
					child.once('exit', () => {
						if (this.childAgents.has(child)) {
							void this.repository.updateRuntimeState(agentId, {
								status: 'error',
								pid: null,
								port: null,
								url: null,
								error: 'Process exited after startup',
							});
						}
						if (this.processes.get(key)?.child === child) this.processes.delete(key);
					});
					resolve({ url: entry.url, workspaceId: entry.workspaceId });
				} catch (error) {
					fail(error instanceof Error ? error : new Error(String(error)));
				}
			};
			child.stdout?.on('data', inspectStdout);

			child.stderr?.on('data', collectStderr);

			child.once('error', fail);
			child.once('exit', (code) => {
				this.children.delete(child);
				this.childAgents.delete(child);
				if (!settled) {
					const detail = sanitizeErrorDetail(
						stderr.trim().split(/\r?\n/).slice(-3).join(' ').trim(),
						2_048,
					);
					const suffix = detail ? `: ${detail}` : '';
					const message = `DeepSeek Harness Web process exited before startup${code === null ? '' : ` with code ${code}`}${suffix}`;
					void this.repository.updateRuntimeState(agentId, {
						status: 'error',
						pid: null,
						port: null,
						url: null,
						error: message,
					});
					fail(new Error(message));
				}
			});
		});
	}

	private async registerDefaultWorkspace(
		runtimeUrl: string,
		workspacePath: string,
	): Promise<string> {
		const auth = await this.fetchFn(runtimeUrl, { redirect: 'manual' });
		const cookie = auth.headers.get('set-cookie')?.split(';', 1)[0];
		if (auth.status !== 303 || !cookie) {
			throw new Error(
				'DeepSeek Harness Web authentication failed while creating the default workspace',
			);
		}

		const endpoint = new URL('/api/workspace/create', runtimeUrl).toString();
		const response = await this.fetchFn(endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({
				type: 'client-request',
				rpcId: `n8n-${crypto.randomUUID()}`,
				method: 'workspace/create',
				payload: { args: { request: { path: workspacePath } } },
			}),
		});
		if (!response.ok) {
			throw new Error(`DeepSeek Harness workspace/create failed with HTTP ${response.status}`);
		}

		const body = (await response.json()) as {
			result?: {
				ok?: boolean;
				value?: { workspace?: { workspaceId?: string } };
				error?: { message?: string };
			};
		};
		if (body.result?.ok !== true) {
			throw new Error(body.result?.error?.message ?? 'DeepSeek Harness workspace/create failed');
		}

		const workspaceId = body.result.value?.workspace?.workspaceId;
		if (!workspaceId) throw new Error('DeepSeek Harness workspace/create returned no workspace ID');
		return workspaceId;
	}

	@OnShutdown()
	async shutdown(): Promise<void> {
		const children = [...this.children];
		const agentIds = [
			...new Set(children.map((child) => this.childAgents.get(child)).filter(Boolean)),
		];
		this.processes.clear();
		this.children.clear();
		this.childAgents.clear();
		for (const child of children) child.kill();
		await Promise.all(
			agentIds.map(async (agentId) => {
				if (!agentId) return;
				await this.repository.updateRuntimeState(agentId, {
					status: 'stopped',
					pid: null,
					port: null,
					url: null,
					error: null,
				});
			}),
		);
	}
}
