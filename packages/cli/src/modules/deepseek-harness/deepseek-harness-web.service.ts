import { DeepSeekHarnessConfig, GlobalConfig } from '@n8n/config';
import { Service } from '@n8n/di';
import { OnShutdown } from '@n8n/decorators';
import { isRecord } from '@n8n/utils/is-record';
import { sanitizeErrorDetail } from '@n8n/utils/redaction/sanitize-error-detail';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { NotFoundError } from '@/errors/response-errors/not-found.error';

import {
	DEFAULT_WORKSPACE_NAME,
	DeepSeekHarnessHomeService,
} from './deepseek-harness-home.service';
import { DeepSeekHarnessCliService, getHarnessEnv } from './deepseek-harness-cli.service';
import { DeepSeekHarnessAgentRepository } from './repositories/deepseek-harness-agent.repository';

const STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;
const STARTUP_OUTPUT_LIMIT = 4_096;
const RPC_TIMEOUT_MS = 30_000;
const WEB_URL_PATTERN = /dsh web:\s+(https?:\/\/\S+)/;
const MODEL_SETTINGS_NAMESPACE = 'agent-default-model';

type SpawnProcess = typeof spawn;
type Fetch = typeof fetch;
export type WebRuntime = {
	url: string;
	workspaceId: string;
	directUrl: string | null;
	directPort: number | null;
};
export type DeepSeekHarnessRuntimeState = {
	status: 'stopped' | 'starting' | 'running' | 'error';
	pid: number | null;
	port: number | null;
	url: string | null;
	error: string | null;
};

export type DeepSeekHarnessPortRange = { min: number; max: number };

export type WebProcessInvocationOptions = {
	port?: number;
	bindHost?: string;
	trustedHosts?: string[];
};

const STOPPED_RUNTIME_STATE: DeepSeekHarnessRuntimeState = {
	status: 'stopped',
	pid: null,
	port: null,
	url: null,
	error: null,
};

export type DeepSeekHarnessModel = {
	id: string;
	name: string;
	description?: string;
	reasoning?: boolean;
};

export type DeepSeekHarnessModelGroup = {
	id: string;
	name: string;
	models: DeepSeekHarnessModel[];
};

export type DeepSeekHarnessModelCatalog = {
	default?: { provider: string; model: string };
	routableProviders: string[];
	groups: DeepSeekHarnessModelGroup[];
	failures: Array<{ id: string; name: string; message: string }>;
};

export type DeepSeekHarnessModelSelection = {
	provider: string;
	model: string;
	apiKey: string;
};

export type DeepSeekHarnessConfigurationStatus = {
	configured: boolean;
	provider: string | null;
	model: string | null;
	credentialRef: string | null;
};

const MODEL_CREDENTIAL_REFS: Record<string, string> = {
	deepseek: 'DEEPSEEK_API_KEY',
	'deepseek-official': 'DEEPSEEK_API_KEY',
	openai: 'OPENAI_API_KEY',
	anthropic: 'ANTHROPIC_API_KEY',
};

type HarnessSettingsDescription = {
	namespaces?: Array<{ ns: string; value?: unknown }>;
};

type HarnessCredentialsDescription = Record<string, { configured?: boolean }>;

export function getHarnessCredentialRef(provider: string | null | undefined): string | null {
	if (!provider) return null;
	return MODEL_CREDENTIAL_REFS[provider.trim().toLowerCase()] ?? null;
}

export function getHarnessConfigurationStatus(
	settings: HarnessSettingsDescription,
	credentials: HarnessCredentialsDescription,
): DeepSeekHarnessConfigurationStatus {
	const modelNamespace = settings.namespaces?.find(({ ns }) => ns === MODEL_SETTINGS_NAMESPACE);
	const modelValue = isRecord(modelNamespace?.value) ? modelNamespace.value : undefined;
	const provider = typeof modelValue?.provider === 'string' ? modelValue.provider.trim() : null;
	const model = typeof modelValue?.model === 'string' ? modelValue.model.trim() : null;
	const credentialRef = getHarnessCredentialRef(provider);

	return {
		configured: Boolean(
			provider && model && credentialRef && credentials[credentialRef]?.configured === true,
		),
		provider: provider || null,
		model: model || null,
		credentialRef,
	};
}

export function appendOutputTail(current: string, chunk: Buffer | string): string {
	return `${current}${chunk.toString()}`.slice(-STARTUP_OUTPUT_LIMIT);
}

export function getPublicHost(config: Pick<GlobalConfig, 'editorBaseUrl' | 'host'>): string {
	const editorBaseUrl = config.editorBaseUrl?.replace(/^["]+|["]+$/g, '');
	return editorBaseUrl ? new URL(editorBaseUrl).hostname : config.host;
}

/** Parse `13080-13089`. Empty or invalid input returns null. */
export function parsePortRange(value: string): DeepSeekHarnessPortRange | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const match = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
	if (!match) return null;
	const min = Number(match[1]);
	const max = Number(match[2]);
	if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 65535 || min > max) {
		return null;
	}
	return { min, max };
}

export function parseTrustedHosts(value: string): string[] {
	return value
		.split(',')
		.map((host) => host.trim())
		.filter((host) => host.length > 0);
}

/**
 * Pick a sticky port: reuse `preferred` when free and in range, otherwise the
 * lowest free port in the pool.
 */
export function allocateStickyPort(
	preferred: number | null | undefined,
	occupied: Iterable<number>,
	range: DeepSeekHarnessPortRange,
): number {
	const taken = new Set(occupied);
	if (
		preferred != null &&
		Number.isInteger(preferred) &&
		preferred >= range.min &&
		preferred <= range.max
	) {
		if (taken.has(preferred)) {
			throw new Error(`DeepSeek Harness sticky port ${preferred} is already assigned`);
		}
		return preferred;
	}
	for (let port = range.min; port <= range.max; port++) {
		if (!taken.has(port)) return port;
	}
	throw new Error(`DeepSeek Harness port range ${range.min}-${range.max} is exhausted`);
}

/** Rewrite the process startup URL onto the browser-facing direct host. */
export function buildDirectAccessUrl(runtimeUrl: string, directHost: string): string | null {
	const host = directHost.trim();
	if (!host) return null;
	const parsed = new URL(runtimeUrl);
	const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
	return `http://${host}:${port}/${parsed.search}`;
}

/**
 * First non-loopback IPv4 on this host. Used when a port pool is enabled but
 * `N8N_DEEPSEEK_HARNESS_BIND_HOST` is empty (typical Docker bridge).
 */
export function detectNonLoopbackIPv4(): string | null {
	for (const addresses of Object.values(networkInterfaces())) {
		if (!addresses) continue;
		for (const entry of addresses) {
			// Node typings use 'IPv4' | 'IPv6'; older runtimes used numeric 4/6.
			if (String(entry.family) !== 'IPv4' && String(entry.family) !== '4') continue;
			if (entry.internal) continue;
			return entry.address;
		}
	}
	return null;
}

export function getWebProcessInvocation(
	harnessPath: string,
	profile: string,
	nodePath: string = process.execPath,
	options: WebProcessInvocationOptions = {},
): { command: string; args: string[] } {
	const bindHost = options.bindHost?.trim();
	const trustedHosts = (options.trustedHosts ?? [])
		.map((host) => host.trim())
		.filter((host) => host.length > 0);
	const port = options.port ?? 0;
	return {
		command: nodePath,
		args: [
			join(harnessPath, 'apps', 'cli', 'lib', 'bin.js'),
			'--profile',
			profile,
			'--no-open',
			'--port',
			String(port),
			...(bindHost ? ['--host', bindHost] : []),
			...trustedHosts.flatMap((host) => ['--trusted-host', host]),
		],
	};
}

@Service()
export class DeepSeekHarnessWebService {
	private readonly processes = new Map<string, { child: ChildProcess } & WebRuntime>();
	private readonly starting = new Map<string, Promise<WebRuntime>>();
	private readonly runtimeStates = new Map<string, DeepSeekHarnessRuntimeState>();
	private readonly children = new Set<ChildProcess>();

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

	getRuntimeState(projectId: string, agentId: string): DeepSeekHarnessRuntimeState {
		return { ...(this.runtimeStates.get(`${projectId}:${agentId}`) ?? STOPPED_RUNTIME_STATE) };
	}

	async startForAgent(agentId: string, projectId: string): Promise<WebRuntime> {
		const key = `${projectId}:${agentId}`;
		const running = this.processes.get(key);
		if (running && !running.child.killed) {
			return {
				url: running.url,
				workspaceId: running.workspaceId,
				directUrl: running.directUrl,
				directPort: running.directPort,
			};
		}

		const starting = this.starting.get(key);
		if (starting) return await starting;

		const promise = this.start(key, agentId, projectId);
		this.starting.set(key, promise);
		try {
			return await promise;
		} catch (error) {
			this.runtimeStates.set(key, {
				...STOPPED_RUNTIME_STATE,
				status: 'error',
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
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
		const exitPromise = this.waitForExit(running.child);
		running.child.kill();
		await exitPromise;
		this.runtimeStates.set(key, { ...STOPPED_RUNTIME_STATE });
	}

	/** Return the model catalog exposed by the running Harness profile. */
	async getModelCatalogForAgent(
		agentId: string,
		projectId: string,
	): Promise<DeepSeekHarnessModelCatalog> {
		const runtime = await this.startForAgent(agentId, projectId);
		const { origin, cookie } = await this.authenticate(runtime.url);
		return await this.callRpc<DeepSeekHarnessModelCatalog>(
			origin,
			cookie,
			'session/modelCatalog',
			{},
		);
	}

	/** Read the non-secret model and credential state of a running profile. */
	async getConfigurationStatusForAgent(
		agentId: string,
		projectId: string,
	): Promise<DeepSeekHarnessConfigurationStatus> {
		const runtime = await this.startForAgent(agentId, projectId);
		return await this.getConfigurationStatusForRuntime(runtime.url);
	}

	/** Read configuration from a Harness Web process that is already running. */
	async getConfigurationStatusForRuntime(
		runtimeUrl: string,
	): Promise<DeepSeekHarnessConfigurationStatus> {
		const { origin, cookie } = await this.authenticate(runtimeUrl);
		const [settings, credentials] = await Promise.all([
			this.callRpc<HarnessSettingsDescription>(origin, cookie, 'settings/describe', {}),
			this.callRpc<HarnessCredentialsDescription>(origin, cookie, 'credentials/describe', {
				refs: [...new Set(Object.values(MODEL_CREDENTIAL_REFS))],
			}),
		]);
		return getHarnessConfigurationStatus(settings, credentials);
	}

	/** Persist a provider, model, and its credential in the Harness profile. */
	async configureModelForAgent(
		agentId: string,
		projectId: string,
		selection: DeepSeekHarnessModelSelection,
	): Promise<void> {
		const credentialRef = getHarnessCredentialRef(selection.provider);
		if (!credentialRef) {
			throw new Error(`DeepSeek Harness provider "${selection.provider}" is not supported by n8n`);
		}

		const runtime = await this.startForAgent(agentId, projectId);
		const { origin, cookie } = await this.authenticate(runtime.url);
		await this.callRpc(origin, cookie, 'credentials/set', {
			ref: credentialRef,
			value: selection.apiKey,
		});

		const described = await this.callRpc<{ namespaces?: Array<{ ns: string; revision: number }> }>(
			origin,
			cookie,
			'settings/describe',
			{},
		);
		const modelSettings = described.namespaces?.find(
			(namespace) => namespace.ns === MODEL_SETTINGS_NAMESPACE,
		);
		await this.callRpc(origin, cookie, 'settings/update', {
			ns: MODEL_SETTINGS_NAMESPACE,
			patch: { provider: selection.provider, model: selection.model },
			expectedRevision: modelSettings?.revision,
		});

		await this.stopForAgent(agentId, projectId);
		await this.startForAgent(agentId, projectId);
	}

	private async authenticate(runtimeUrl: string): Promise<{ origin: string; cookie: string }> {
		const response = await this.fetchFn(runtimeUrl, {
			redirect: 'manual',
			signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
		});
		const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
		if (response.status !== 303 || !cookie) {
			throw new Error('DeepSeek Harness Web authentication failed while configuring the profile');
		}
		return { origin: new URL(runtimeUrl).origin, cookie };
	}

	private async callRpc<T = void>(
		origin: string,
		cookie: string,
		endpoint: string,
		args: object,
	): Promise<T> {
		const response = await this.fetchFn(`${origin}/api/${endpoint}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie },
			signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
			body: JSON.stringify({
				type: 'client-request',
				rpcId: `n8n-${crypto.randomUUID()}`,
				method: endpoint,
				payload: { args },
			}),
		});
		if (!response.ok) throw new Error(`DeepSeek Harness ${endpoint} failed`);

		const body = (await response.json()) as {
			result?: { ok?: boolean; value?: T; error?: { message?: string } };
		};
		if (body.result?.ok !== true) {
			throw new Error(body.result?.error?.message ?? `DeepSeek Harness ${endpoint} failed`);
		}
		return body.result.value as T;
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

	private resolveTrustedHosts(): string[] {
		const configured = parseTrustedHosts(this.config.trustedHosts ?? '');
		if (configured.length > 0) return configured;
		const publicHost = getPublicHost(this.globalConfig).trim();
		return publicHost ? [publicHost] : [];
	}

	/**
	 * Resolve `--host`. Prefer the configured bind host; when a sticky port pool
	 * is active and bind host is empty, pick a concrete non-loopback IPv4 so
	 * Docker can publish the port (Harness rejects `0.0.0.0`).
	 */
	private resolveBindHost(stickyPortsEnabled: boolean): string {
		const configured = (this.config.bindHost ?? '').trim();
		if (configured) return configured;
		if (!stickyPortsEnabled) return '';
		return detectNonLoopbackIPv4() ?? '';
	}

	/**
	 * Assign and persist a sticky port when a port range is configured.
	 * Returns null when the pool is disabled (`PORT_RANGE` empty).
	 */
	private async ensureDirectPort(agent: {
		id: string;
		directPort?: number | null;
	}): Promise<number | null> {
		const range = parsePortRange(this.config.portRange ?? '');
		if (!range) return null;

		const preferred = agent.directPort ?? null;
		if (preferred != null && preferred >= range.min && preferred <= range.max) {
			const occupied = await this.repository.findOccupiedDirectPorts(agent.id);
			if (occupied.includes(preferred)) {
				throw new Error(`DeepSeek Harness sticky port ${preferred} is already assigned`);
			}
			return preferred;
		}

		const occupied = await this.repository.findOccupiedDirectPorts(agent.id);
		const port = allocateStickyPort(preferred, occupied, range);
		await this.repository.update({ id: agent.id }, { directPort: port });
		agent.directPort = port;
		return port;
	}

	private async start(key: string, agentId: string, projectId: string): Promise<WebRuntime> {
		this.runtimeStates.set(key, { ...STOPPED_RUNTIME_STATE, status: 'starting' });
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
		const directPort = await this.ensureDirectPort(agent);
		const bindHost = this.resolveBindHost(directPort != null);
		const directHost = (this.config.directHost ?? '').trim() || bindHost || '';
		const invocation = getWebProcessInvocation(harnessPath, profile, nodePath, {
			port: directPort ?? 0,
			bindHost: bindHost || undefined,
			trustedHosts: this.resolveTrustedHosts(),
		});
		const child = this.spawnProcess(invocation.command, invocation.args, {
			cwd: harnessPath,
			env: getHarnessEnv(harnessPath, home),
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		this.children.add(child);

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
				this.runtimeStates.set(key, {
					...STOPPED_RUNTIME_STATE,
					status: 'error',
					error: error.message,
				});
				this.children.delete(child);
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
					const directUrl = buildDirectAccessUrl(match[1], directHost);
					const entry = {
						child,
						url: match[1],
						workspaceId,
						directUrl,
						directPort: directPort ?? (Number(new URL(match[1]).port) || null),
					};
					settled = true;
					clearTimeout(timeout);
					this.processes.set(key, entry);
					this.runtimeStates.set(key, {
						status: 'running',
						pid: child.pid ?? null,
						port: entry.directPort,
						url: entry.url,
						error: null,
					});
					child.once('exit', () => {
						this.children.delete(child);
						if (this.processes.get(key)?.child !== child) return;
						this.processes.delete(key);
						this.runtimeStates.set(key, {
							...STOPPED_RUNTIME_STATE,
							status: 'error',
							error: 'Process exited after startup',
						});
					});
					resolve({
						url: entry.url,
						workspaceId: entry.workspaceId,
						directUrl: entry.directUrl,
						directPort: entry.directPort,
					});
				} catch (error) {
					fail(error instanceof Error ? error : new Error(String(error)));
				}
			};
			child.stdout?.on('data', inspectStdout);

			child.stderr?.on('data', collectStderr);

			child.once('error', fail);
			child.once('exit', (code) => {
				this.children.delete(child);
				if (!settled) {
					const detail = sanitizeErrorDetail(
						stderr.trim().split(/\r?\n/).slice(-3).join(' ').trim(),
						2_048,
					);
					const suffix = detail ? `: ${detail}` : '';
					const message = `DeepSeek Harness Web process exited before startup${code === null ? '' : ` with code ${code}`}${suffix}`;
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
		this.processes.clear();
		this.children.clear();
		for (const child of children) child.kill();
		for (const key of this.runtimeStates.keys()) {
			this.runtimeStates.set(key, { ...STOPPED_RUNTIME_STATE });
		}
	}
}
