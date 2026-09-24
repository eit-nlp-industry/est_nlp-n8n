import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import {
	appendOutputTail,
	DeepSeekHarnessWebService,
	getPublicHost,
	getWebProcessInvocation,
} from '../deepseek-harness-web.service';

function createChild() {
	const child = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
	child.stdout = new EventEmitter() as ChildProcess['stdout'];
	child.stderr = new EventEmitter() as ChildProcess['stderr'];
	(child as { pid: number }).pid = 43123;
	child.kill = vi.fn(() => {
		queueMicrotask(() => child.emit('exit', 0));
		return true;
	});
	return child;
}

describe('DeepSeekHarnessWebService', () => {
	it('starts one Web process per agent and reuses its URL', async () => {
		const child = createChild();
		const spawn = vi.fn(() => child);
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, { status: 303, headers: { 'set-cookie': 'session=test' } }),
			)
			.mockResolvedValue(
				new Response(
					JSON.stringify({
						result: { ok: true, value: { workspace: { workspaceId: 'workspace-1' } } },
					}),
					{ status: 200 },
				),
			);
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue({
				id: 'agent-1',
				projectId: 'project-1',
				name: 'Agent',
				userName: 'user@example.com',
			}),
			updateRuntimeState: vi.fn().mockResolvedValue(undefined),
		};
		const homeService = {
			getHome: vi.fn().mockReturnValue('D:/dsh/user/Agent-agent-1'),
			createDefaultWorkspace: vi
				.fn()
				.mockResolvedValue('D:/dsh/user/Agent-agent-1/empty-workspace'),
		};
		const service = new DeepSeekHarnessWebService(
			repository as never,
			homeService as never,
			{ ensureWorkspaceDirectory: vi.fn() } as never,
			{ path: 'D:/deepseek-harness', profile: 'n8n-web' } as never,
			{ host: 'n8n.home' } as never,
			spawn as never,
			fetchFn as never,
		);

		const first = service.startForAgent('agent-1', 'project-1');
		await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
		child.stdout?.emit('data', Buffer.from('dsh web: http://127.0.0.1:43123/?token=secret\n'));
		child.stdout?.emit('data', Buffer.from('dsh web: http://127.0.0.1:43123/?token=secret\n'));
		const firstUrl = await first;
		const secondUrl = await service.startForAgent('agent-1', 'project-1');

		expect(firstUrl).toEqual({
			url: 'http://127.0.0.1:43123/?token=secret',
			workspaceId: 'workspace-1',
		});
		expect(secondUrl).toEqual(firstUrl);
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(spawn).toHaveBeenCalledWith(
			process.execPath,
			[
				join('D:/deepseek-harness', 'apps', 'cli', 'lib', 'bin.js'),
				'--profile',
				'n8n-web',
				'--no-open',
				'--port',
				'0',
				'--trusted-host',
				'n8n.home',
			],
			expect.objectContaining({
				cwd: 'D:/deepseek-harness',
				env: expect.objectContaining({ DSH_HOME: 'D:/dsh/user/Agent-agent-1' }),
			}),
		);
		expect(repository.updateRuntimeState).toHaveBeenCalledWith('agent-1', {
			status: 'running',
			pid: 43123,
			port: 43123,
			url: null,
			error: null,
		});
		expect(child.stdout?.listenerCount('data')).toBe(0);
		expect(child.stderr?.listenerCount('data')).toBe(0);

		await service.shutdown();
		expect(child.kill).toHaveBeenCalled();
		expect(repository.updateRuntimeState).toHaveBeenLastCalledWith('agent-1', {
			status: 'stopped',
			pid: null,
			port: null,
			url: null,
			error: null,
		});
	});

	it('uses a configured Node binary for the Web process', async () => {
		const child = createChild();
		const spawn = vi.fn(() => child);
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, { status: 303, headers: { 'set-cookie': 'session=test' } }),
			)
			.mockResolvedValue(
				new Response(
					JSON.stringify({
						result: { ok: true, value: { workspace: { workspaceId: 'workspace-1' } } },
					}),
					{ status: 200 },
				),
			);
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue({
				id: 'agent-1',
				projectId: 'project-1',
				name: 'Agent',
				userName: 'user@example.com',
			}),
			updateRuntimeState: vi.fn().mockResolvedValue(undefined),
		};
		const homeService = {
			getHome: vi.fn().mockReturnValue('/data/dsh/user/Agent-agent-1'),
			createDefaultWorkspace: vi
				.fn()
				.mockResolvedValue('/data/dsh/user/Agent-agent-1/empty-workspace'),
		};
		const service = new DeepSeekHarnessWebService(
			repository as never,
			homeService as never,
			{ ensureWorkspaceDirectory: vi.fn() } as never,
			{
				path: '/opt/deepseek-harness',
				profile: 'n8n-web',
				nodePath: '/opt/glibc-node/bin/node-glibc',
			} as never,
			{ host: 'n8n.home' } as never,
			spawn as never,
			fetchFn as never,
		);

		const started = service.startForAgent('agent-1', 'project-1');
		await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
		child.stdout?.emit('data', Buffer.from('dsh web: http://127.0.0.1:43123/?token=secret\n'));
		await started;

		expect(spawn).toHaveBeenCalledWith(
			'/opt/glibc-node/bin/node-glibc',
			expect.any(Array),
			expect.any(Object),
		);
		await service.shutdown();
	});

	it('kills the Web process when workspace registration fails', async () => {
		const child = createChild();
		const spawn = vi.fn(() => child);
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, { status: 303, headers: { 'set-cookie': 'session=test' } }),
			)
			.mockResolvedValueOnce(new Response(null, { status: 500 }));
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue({
				id: 'agent-1',
				projectId: 'project-1',
				name: 'Agent',
				userName: 'user@example.com',
			}),
			updateRuntimeState: vi.fn().mockResolvedValue(undefined),
		};
		const service = new DeepSeekHarnessWebService(
			repository as never,
			{
				getHome: vi.fn().mockReturnValue('D:/dsh/home'),
				createDefaultWorkspace: vi.fn().mockResolvedValue('D:/dsh/home/empty-workspace'),
			} as never,
			{ ensureWorkspaceDirectory: vi.fn() } as never,
			{ path: 'D:/deepseek-harness', profile: 'n8n-web' } as never,
			{ host: 'n8n.home' } as never,
			spawn as never,
			fetchFn as never,
		);

		const result = service.startForAgent('agent-1', 'project-1');
		await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
		child.stdout?.emit('data', Buffer.from('dsh web: http://127.0.0.1:43123/?token=secret\n'));

		await expect(result).rejects.toThrow('workspace/create failed with HTTP 500');
		expect(child.kill).toHaveBeenCalled();
	});

	it('registers the default empty workspace before returning the Web URL', async () => {
		const child = createChild();
		const spawn = vi.fn(() => child);
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 303,
					headers: { 'set-cookie': 'session=harness-session; Path=/' },
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						result: {
							ok: true,
							value: { workspace: { workspaceId: 'workspace-1' }, created: true },
						},
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			);
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue({
				id: 'agent-1',
				projectId: 'project-1',
				name: 'Agent',
				userName: 'user@example.com',
			}),
			updateRuntimeState: vi.fn().mockResolvedValue(undefined),
		};
		const homeService = {
			getHome: vi.fn().mockReturnValue('D:/dsh/user/Agent-agent-1'),
			createDefaultWorkspace: vi
				.fn()
				.mockResolvedValue('D:/dsh/user/Agent-agent-1/empty-workspace'),
		};
		const service = new DeepSeekHarnessWebService(
			repository as never,
			homeService as never,
			{ ensureWorkspaceDirectory: vi.fn() } as never,
			{ path: 'D:/deepseek-harness', profile: 'n8n-web' } as never,
			{ host: 'n8n.home' } as never,
			spawn as never,
			fetchFn as never,
		);

		const result = service.startForAgent('agent-1', 'project-1');
		await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
		child.stdout?.emit('data', Buffer.from('dsh web: http://127.0.0.1:43123/?token=secret\n'));

		await expect(result).resolves.toEqual({
			url: 'http://127.0.0.1:43123/?token=secret',
			workspaceId: 'workspace-1',
		});
		expect(homeService.createDefaultWorkspace).toHaveBeenCalledWith(
			'user@example.com',
			'Agent',
			'agent-1',
		);
		expect(fetchFn).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:43123/?token=secret', {
			redirect: 'manual',
		});
		expect(fetchFn).toHaveBeenNthCalledWith(
			2,
			'http://127.0.0.1:43123/api/workspace/create',
			expect.objectContaining({
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: 'session=harness-session' },
			}),
		);

		await service.shutdown();
	});

	it('reuses the registered default workspace after a Web restart', async () => {
		const child = createChild();
		const spawn = vi.fn(() => child);
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, { status: 303, headers: { 'set-cookie': 'session=test' } }),
			);
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue({
				id: 'agent-1',
				projectId: 'project-1',
				name: 'Agent',
				userName: 'user@example.com',
			}),
			updateRuntimeState: vi.fn().mockResolvedValue(undefined),
		};
		const homeService = {
			getHome: vi.fn().mockReturnValue('D:/dsh/user/Agent-agent-1'),
			createDefaultWorkspace: vi.fn(),
			listWorkspaces: vi.fn().mockResolvedValue([{ id: 'workspace-1', name: 'empty-workspace' }]),
		};
		const service = new DeepSeekHarnessWebService(
			repository as never,
			homeService as never,
			{ ensureWorkspaceDirectory: vi.fn() } as never,
			{ path: 'D:/deepseek-harness', profile: 'n8n-web' } as never,
			{ host: 'n8n.home' } as never,
			spawn as never,
			fetchFn as never,
		);

		const result = service.startForAgent('agent-1', 'project-1');
		await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
		child.stdout?.emit('data', Buffer.from('dsh web: http://127.0.0.1:43123/?token=secret\n'));

		await expect(result).resolves.toEqual({
			url: 'http://127.0.0.1:43123/?token=secret',
			workspaceId: 'workspace-1',
		});
		expect(homeService.createDefaultWorkspace).not.toHaveBeenCalled();
		expect(fetchFn).not.toHaveBeenCalled();

		await service.shutdown();
	});

	it('rejects when the agent is not in the project', async () => {
		const service = new DeepSeekHarnessWebService(
			{ findByIdAndProjectId: vi.fn().mockResolvedValue(null) } as never,
			{ getHome: vi.fn() } as never,
			{ ensureWorkspaceDirectory: vi.fn() } as never,
			{ path: 'D:/deepseek-harness', profile: 'n8n-web' } as never,
			{ host: 'n8n.home' } as never,
			vi.fn(),
		);

		await expect(service.startForAgent('agent-1', 'project-1')).rejects.toThrow(
			'DeepSeek Harness agent "agent-1" not found',
		);
	});

	it('rejects when the child exits before reporting a URL', async () => {
		const child = createChild();
		const spawn = vi.fn(() => child);
		const service = new DeepSeekHarnessWebService(
			{
				findByIdAndProjectId: vi.fn().mockResolvedValue({
					id: 'agent-1',
					projectId: 'project-1',
					name: 'Agent',
					userName: 'user@example.com',
				}),
				updateRuntimeState: vi.fn().mockResolvedValue(undefined),
			} as never,
			{
				getHome: vi.fn().mockReturnValue('D:/dsh/home'),
				createDefaultWorkspace: vi.fn().mockResolvedValue('D:/dsh/home/empty-workspace'),
			} as never,
			{ ensureWorkspaceDirectory: vi.fn() } as never,
			{ path: 'D:/deepseek-harness', profile: 'n8n-web' } as never,
			{ host: 'n8n.home' } as never,
			spawn as never,
		);

		const result = service.startForAgent('agent-1', 'project-1');
		await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
		child.stderr?.emit('data', 'token=secret\nFailed to bind');
		child.emit('exit', 1);

		await expect(result).rejects.toThrow(
			'DeepSeek Harness Web process exited before startup with code 1: [REDACTED] Failed to bind',
		);
	});

	it('stops the running Web process for an agent', async () => {
		const child = createChild();
		const spawn = vi.fn(() => child);
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue({
				id: 'agent-1',
				projectId: 'project-1',
				name: 'Agent',
				userName: 'user@example.com',
			}),
			updateRuntimeState: vi.fn().mockResolvedValue(undefined),
		};
		const service = new DeepSeekHarnessWebService(
			repository as never,
			{
				getHome: vi.fn().mockReturnValue('D:/dsh/home'),
				createDefaultWorkspace: vi.fn().mockResolvedValue('D:/dsh/home/empty-workspace'),
			} as never,
			{ ensureWorkspaceDirectory: vi.fn() } as never,
			{ path: 'D:/deepseek-harness', profile: 'n8n-web' } as never,
			{ host: 'n8n.home' } as never,
			spawn as never,
			vi
				.fn()
				.mockResolvedValueOnce(
					new Response(null, { status: 303, headers: { 'set-cookie': 'session=test' } }),
				)
				.mockResolvedValue(
					new Response(
						JSON.stringify({
							result: { ok: true, value: { workspace: { workspaceId: 'workspace-1' } } },
						}),
						{ status: 200 },
					),
				) as never,
		);

		const result = service.startForAgent('agent-1', 'project-1');
		await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
		child.stdout?.emit('data', Buffer.from('dsh web: http://127.0.0.1:43123/?token=secret\n'));
		await result;

		await service.stopForAgent('agent-1', 'project-1');

		expect(child.kill).toHaveBeenCalled();
		expect(repository.updateRuntimeState).toHaveBeenLastCalledWith('agent-1', {
			status: 'stopped',
			pid: null,
			port: null,
			url: null,
			error: null,
		});
	});
});

describe('getWebProcessInvocation', () => {
	it('adds the public n8n host to the Harness trust fence', () => {
		expect(
			getWebProcessInvocation(
				'/opt/deepseek-harness',
				'n8n-web',
				'/opt/glibc-node/bin/node-glibc',
				'n8n.home',
			),
		).toEqual({
			command: '/opt/glibc-node/bin/node-glibc',
			args: [
				join('/opt/deepseek-harness', 'apps', 'cli', 'lib', 'bin.js'),
				'--profile',
				'n8n-web',
				'--no-open',
				'--port',
				'0',
				'--trusted-host',
				'n8n.home',
			],
		});
	});
});

describe('getPublicHost', () => {
	it('prefers the public editor hostname', () => {
		expect(
			getPublicHost({
				editorBaseUrl: 'https://editor.example.com/n8n/',
				host: 'localhost',
			}),
		).toBe('editor.example.com');
	});

	it('falls back to the configured n8n host', () => {
		expect(getPublicHost({ editorBaseUrl: '', host: 'n8n.home' })).toBe('n8n.home');
	});
});

describe('appendOutputTail', () => {
	it('keeps only the bounded output tail', () => {
		const marker = 'latest output';
		const result = appendOutputTail('', `${'x'.repeat(5_000)}${marker}`);

		expect(result).toHaveLength(4_096);
		expect(result.endsWith(marker)).toBe(true);
	});
});
