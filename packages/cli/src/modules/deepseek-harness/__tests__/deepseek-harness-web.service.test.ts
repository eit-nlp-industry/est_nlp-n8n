import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import { DeepSeekHarnessWebService } from '../deepseek-harness-web.service';

function createChild() {
	const child = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
	child.stdout = new EventEmitter() as ChildProcess['stdout'];
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
		const fetchFn = vi.fn()
			.mockResolvedValueOnce(new Response(null, { status: 303, headers: { 'set-cookie': 'session=test' } }))
			.mockResolvedValue(new Response(JSON.stringify({
				result: { ok: true, value: { workspace: { workspaceId: 'workspace-1' } } },
			}), { status: 200 }));
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
			createDefaultWorkspace: vi.fn().mockResolvedValue('D:/dsh/user/Agent-agent-1/empty-workspace'),
		};
		const service = new DeepSeekHarnessWebService(
			repository as never,
			homeService as never,
			{ ensureWorkspaceDirectory: vi.fn() } as never,
			{ path: 'D:/deepseek-harness', profile: 'n8n-web' } as never,
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

	it('kills the Web process when workspace registration fails', async () => {
		const child = createChild();
		const spawn = vi.fn(() => child);
		const fetchFn = vi.fn()
			.mockResolvedValueOnce(new Response(null, { status: 303, headers: { 'set-cookie': 'session=test' } }))
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
		const fetchFn = vi.fn()
			.mockResolvedValueOnce(new Response(null, {
				status: 303,
				headers: { 'set-cookie': 'session=harness-session; Path=/' },
			}))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				result: {
					ok: true,
					value: { workspace: { workspaceId: 'workspace-1' }, created: true },
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }));
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
			createDefaultWorkspace: vi.fn().mockResolvedValue('D:/dsh/user/Agent-agent-1/empty-workspace'),
		};
		const service = new DeepSeekHarnessWebService(
			repository as never,
			homeService as never,
			{ ensureWorkspaceDirectory: vi.fn() } as never,
			{ path: 'D:/deepseek-harness', profile: 'n8n-web' } as never,
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
		expect(fetchFn).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:43123/?token=secret', { redirect: 'manual' });
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
		const fetchFn = vi.fn().mockResolvedValueOnce(
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
			spawn as never,
		);

		const result = service.startForAgent('agent-1', 'project-1');
		await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
		child.emit('exit', 1);

		await expect(result).rejects.toThrow('DeepSeek Harness Web process exited before startup');
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
			spawn as never,
			vi.fn()
				.mockResolvedValueOnce(new Response(null, { status: 303, headers: { 'set-cookie': 'session=test' } }))
				.mockResolvedValue(new Response(JSON.stringify({
					result: { ok: true, value: { workspace: { workspaceId: 'workspace-1' } } },
				}), { status: 200 })) as never,
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
