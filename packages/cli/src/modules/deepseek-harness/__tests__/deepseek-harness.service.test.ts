import { vi } from 'vitest';

import { DeepSeekHarnessService } from '../deepseek-harness.service';

describe('DeepSeekHarnessService', () => {
	it('creates a project-scoped agent and its isolated home', async () => {
		const repository = {
			create: vi.fn((data: unknown) => data),
			save: vi.fn(async (agent: unknown) => agent),
			findStartingWith: vi.fn().mockResolvedValue([]),
		};
		const homeService = {
			createHome: vi.fn(async () => 'C:/dsh/user@example.com/Research agent-agent-1'),
			createDefaultWorkspace: vi.fn(async () => 'C:/dsh/user@example.com/empty-workspace'),
			removeHome: vi.fn(async () => {}),
		};
		const cliService = { initializeProfile: vi.fn(async () => {}) };
		const service = new DeepSeekHarnessService(
			repository as never,
			homeService as never,
			cliService as never,
			undefined as never,
		);

		const result = await service.createForProject('user@example.com', 'project-1');

		expect(result.name).toBe('DeepSeek Harness');
		expect(result.projectId).toBe('project-1');
		expect(result.status).toBe('created');
		expect(homeService.createHome).toHaveBeenCalledWith(
			'user@example.com',
			'DeepSeek Harness',
			result.id,
		);
		expect(cliService.initializeProfile).toHaveBeenCalledWith(
			'C:/dsh/user@example.com/Research agent-agent-1',
		);
		expect(repository.save).toHaveBeenCalledWith(
			expect.objectContaining({
				id: result.id,
				projectId: 'project-1',
				name: 'DeepSeek Harness',
				userName: 'user@example.com',
				status: 'created',
			}),
		);
	});

	it('removes the home when persistence fails', async () => {
		const repository = {
			create: vi.fn((data: unknown) => data),
			save: vi.fn(async () => {
				throw new Error('database unavailable');
			}),
			findStartingWith: vi.fn().mockResolvedValue([]),
		};
		const homeService = {
			createHome: vi.fn(async () => 'C:/dsh/user@example.com/Research agent-agent-1'),
			createDefaultWorkspace: vi.fn(async () => 'C:/dsh/user@example.com/empty-workspace'),
			removeHome: vi.fn(async () => {}),
		};
		const cliService = { initializeProfile: vi.fn(async () => {}) };
		const service = new DeepSeekHarnessService(
			repository as never,
			homeService as never,
			cliService as never,
			undefined as never,
		);

		await expect(service.createForProject('user@example.com', 'project-1')).rejects.toThrow(
			'database unavailable',
		);
		expect(homeService.removeHome).toHaveBeenCalledWith(
			'user@example.com',
			'DeepSeek Harness',
			expect.any(String),
		);
	});

	it('removes the home when Harness profile initialization fails', async () => {
		const repository = {
			create: vi.fn((data: unknown) => data),
			save: vi.fn(),
			findStartingWith: vi.fn().mockResolvedValue([]),
		};
		const homeService = {
			createHome: vi.fn(async () => 'C:/dsh/user@example.com/Research agent-agent-1'),
			createDefaultWorkspace: vi.fn(async () => 'C:/dsh/user@example.com/empty-workspace'),
			removeHome: vi.fn(async () => {}),
		};
		const cliService = {
			initializeProfile: vi.fn(async () => {
				throw new Error('Harness initialization failed');
			}),
		};
		const service = new DeepSeekHarnessService(
			repository as never,
			homeService as never,
			cliService as never,
			undefined as never,
		);

		await expect(service.createForProject('user@example.com', 'project-1')).rejects.toThrow(
			'Harness initialization failed',
		);
		expect(repository.save).not.toHaveBeenCalled();
		expect(homeService.removeHome).toHaveBeenCalledWith(
			'user@example.com',
			'DeepSeek Harness',
			expect.any(String),
		);
	});

	it('uses the next workflow-style suffix for an existing default name', async () => {
		const repository = {
			create: vi.fn((data: unknown) => data),
			save: vi.fn(async (agent: unknown) => agent),
			findStartingWith: vi
				.fn()
				.mockResolvedValue([{ name: 'DeepSeek Harness' }, { name: 'DeepSeek Harness 2' }]),
		};
		const homeService = {
			createHome: vi.fn(async () => 'C:/dsh/user@example.com/DeepSeek Harness 3-agent-1'),
			createDefaultWorkspace: vi.fn(async () => 'C:/dsh/user@example.com/empty-workspace'),
			removeHome: vi.fn(async () => {}),
		};
		const cliService = { initializeProfile: vi.fn(async () => {}) };
		const service = new DeepSeekHarnessService(
			repository as never,
			homeService as never,
			cliService as never,
			undefined as never,
		);

		const result = await service.createForProject('user@example.com', 'project-1');

		expect(result.name).toBe('DeepSeek Harness 3');
		expect(repository.findStartingWith).toHaveBeenCalledWith('DeepSeek Harness');
	});

	it('ignores unrelated names when choosing the default name', async () => {
		const repository = {
			create: vi.fn((data: unknown) => data),
			save: vi.fn(async (agent: unknown) => agent),
			findStartingWith: vi.fn().mockResolvedValue([{ name: 'DeepSeek Harness copy' }]),
		};
		const homeService = {
			createHome: vi.fn(async () => 'C:/dsh/home'),
			createDefaultWorkspace: vi.fn(async () => 'C:/dsh/home/empty-workspace'),
			removeHome: vi.fn(async () => {}),
		};
		const service = new DeepSeekHarnessService(
			repository as never,
			homeService as never,
			{ initializeProfile: vi.fn(async () => {}) } as never,
			undefined as never,
		);

		await expect(service.createForProject('user@example.com', 'project-1')).resolves.toEqual(
			expect.objectContaining({ name: 'DeepSeek Harness' }),
		);
	});

	it('publishes an agent only after its Web process starts', async () => {
		const agent = {
			id: 'agent-1',
			projectId: 'project-1',
			name: 'Agent',
			userName: 'user@example.com',
			published: false,
			status: 'created',
		};
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue(agent),
			save: vi.fn().mockResolvedValue(agent),
		};
		const webService = {
			startForAgent: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:43123' }),
			stopForAgent: vi.fn().mockResolvedValue(undefined),
		};
		const service = new DeepSeekHarnessService(
			repository as never,
			{} as never,
			{} as never,
			webService as never,
		);

		await expect(service.publishForProject('agent-1', 'project-1')).resolves.toEqual(
			expect.objectContaining({ published: true }),
		);
		expect(webService.startForAgent).toHaveBeenCalledWith('agent-1', 'project-1');
		expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ published: true }));
	});

	it('restarts Studio by stopping then starting the Web process', async () => {
		const order: string[] = [];
		const webService = {
			stopForAgent: vi.fn().mockImplementation(async () => {
				order.push('stop');
			}),
			startForAgent: vi.fn().mockImplementation(async () => {
				order.push('start');
				return { url: 'http://127.0.0.1:43124/?token=y' };
			}),
		};
		const service = new DeepSeekHarnessService(
			{} as never,
			{} as never,
			{} as never,
			webService as never,
		);

		await expect(service.restartStudioForProject('agent-1', 'project-1')).resolves.toEqual({
			url: '/deepseek-harness-studio/project-1/agent-1/?token=y',
		});
		expect(order).toEqual(['stop', 'start']);
		expect(webService.stopForAgent).toHaveBeenCalledWith('agent-1', 'project-1');
		expect(webService.startForAgent).toHaveBeenCalledWith('agent-1', 'project-1');
	});

	it('serializes lifecycle operations for the same agent', async () => {
		let releaseStart!: () => void;
		const start = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		const agent = {
			id: 'agent-1',
			projectId: 'project-1',
			name: 'Agent',
			userName: 'user@example.com',
			published: false,
			status: 'created',
		};
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue(agent),
			save: vi.fn().mockImplementation(async (value: unknown) => value),
		};
		const webService = {
			startForAgent: vi.fn().mockImplementation(async () => await start),
			stopForAgent: vi.fn().mockResolvedValue(undefined),
		};
		const service = new DeepSeekHarnessService(
			repository as never,
			{} as never,
			{} as never,
			webService as never,
		);

		const publish = service.publishForProject('agent-1', 'project-1');
		await vi.waitFor(() => expect(webService.startForAgent).toHaveBeenCalledOnce());
		const unpublish = service.unpublishForProject('agent-1', 'project-1');
		await Promise.resolve();
		expect(repository.findByIdAndProjectId).toHaveBeenCalledOnce();

		releaseStart();
		await Promise.all([publish, unpublish]);
		expect(repository.findByIdAndProjectId).toHaveBeenCalledTimes(2);
	});

	it('hard deletes the project agent and its home', async () => {
		const agent = {
			id: 'agent-1',
			projectId: 'project-1',
			name: 'Research agent',
			userName: 'user@example.com',
		};
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue(agent),
			deleteByIdAndProjectId: vi.fn().mockResolvedValue(true),
		};
		const order: string[] = [];
		const homeService = {
			stageHomeForDeletion: vi.fn(async () => {
				order.push('home');
				return [{ originalPath: 'home', stagedPath: 'staged-home' }];
			}),
			restoreStagedHomes: vi.fn(async () => {}),
			removeStagedHomes: vi.fn(async () => {}),
		};
		const webService = { stopForAgent: vi.fn().mockResolvedValue(undefined) };
		webService.stopForAgent.mockImplementation(async () => order.push('stop'));
		repository.deleteByIdAndProjectId.mockImplementation(async () => {
			order.push('database');
			return true;
		});
		const service = new DeepSeekHarnessService(
			repository as never,
			homeService as never,
			{} as never,
			webService as never,
		);

		await expect(service.deleteForProject('agent-1', 'project-1')).resolves.toBe(true);

		expect(repository.deleteByIdAndProjectId).toHaveBeenCalledWith('agent-1', 'project-1');
		expect(webService.stopForAgent).toHaveBeenCalledWith('agent-1', 'project-1');
		expect(homeService.stageHomeForDeletion).toHaveBeenCalledWith(
			'user@example.com',
			'Research agent',
			'agent-1',
		);
		expect(order).toEqual(['stop', 'home', 'database']);
	});

	it('removes the legacy home for an agent created before account scoping', async () => {
		const agent = {
			id: 'agent-1',
			projectId: 'project-1',
			name: 'Research agent',
			userName: null,
		};
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue(agent),
			deleteByIdAndProjectId: vi.fn().mockResolvedValue(true),
		};
		const homeService = {
			stageLegacyHomeForDeletion: vi.fn().mockResolvedValue([]),
			restoreStagedHomes: vi.fn().mockResolvedValue(undefined),
			removeStagedHomes: vi.fn().mockResolvedValue(undefined),
		};
		const webService = { stopForAgent: vi.fn().mockResolvedValue(undefined) };
		const service = new DeepSeekHarnessService(
			repository as never,
			homeService as never,
			{} as never,
			webService as never,
		);

		await expect(service.deleteForProject('agent-1', 'project-1')).resolves.toBe(true);

		expect(homeService.stageLegacyHomeForDeletion).toHaveBeenCalledWith('agent-1');
	});

	it('restores the staged home when database deletion fails', async () => {
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue({
				id: 'agent-1',
				projectId: 'project-1',
				name: 'Research agent',
				userName: 'user@example.com',
			}),
			deleteByIdAndProjectId: vi.fn().mockRejectedValue(new Error('database unavailable')),
		};
		const staged = [{ originalPath: 'home', stagedPath: 'staged-home' }];
		const homeService = {
			stageHomeForDeletion: vi.fn().mockResolvedValue(staged),
			restoreStagedHomes: vi.fn().mockResolvedValue(undefined),
			removeStagedHomes: vi.fn().mockResolvedValue(undefined),
		};
		const service = new DeepSeekHarnessService(
			repository as never,
			homeService as never,
			{} as never,
			{ stopForAgent: vi.fn().mockResolvedValue(undefined) } as never,
		);

		await expect(service.deleteForProject('agent-1', 'project-1')).rejects.toThrow(
			'database unavailable',
		);
		expect(homeService.restoreStagedHomes).toHaveBeenCalledWith(staged);
		expect(homeService.removeStagedHomes).not.toHaveBeenCalled();
	});

	it('renames the account-scoped home before saving the new name', async () => {
		const agent = {
			id: 'agent-1',
			projectId: 'project-1',
			name: 'DeepSeek Harness',
			userName: 'user@example.com',
		};
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue(agent),
			save: vi.fn().mockResolvedValue(agent),
		};
		const homeService = {
			getHome: vi.fn((user: string, name: string, id: string) => `${user}/${name}-${id}`),
			migrateWorkspacePaths: vi.fn().mockResolvedValue(undefined),
			renameHome: vi.fn().mockResolvedValue(undefined),
		};
		const webService = {
			rebaseWorkspacePaths: vi.fn().mockResolvedValue(undefined),
			stopForAgent: vi.fn().mockResolvedValue(undefined),
		};
		const service = new DeepSeekHarnessService(
			repository as never,
			homeService as never,
			{} as never,
			webService as never,
		);

		await expect(service.updateForProject('agent-1', 'project-1', 'Renamed')).resolves.toEqual(
			expect.objectContaining({ name: 'Renamed' }),
		);
		expect(homeService.renameHome).toHaveBeenCalledWith(
			'user@example.com',
			'DeepSeek Harness',
			'Renamed',
			'agent-1',
		);
	});

	it('stops and restarts a running agent while renaming its home', async () => {
		const agent = {
			id: 'agent-1',
			projectId: 'project-1',
			name: 'DeepSeek Harness',
			userName: 'user@example.com',
			published: true,
			runtimeStatus: 'running',
		};
		const repository = {
			findByIdAndProjectId: vi.fn().mockResolvedValue(agent),
			save: vi.fn().mockResolvedValue({ ...agent, name: 'Renamed' }),
		};
		const homeService = {
			getHome: vi.fn((user: string, name: string, id: string) => `${user}/${name}-${id}`),
			migrateWorkspacePaths: vi.fn().mockResolvedValue(undefined),
			renameHome: vi.fn().mockResolvedValue(undefined),
		};
		const webService = {
			rebaseWorkspacePaths: vi.fn().mockResolvedValue(undefined),
			stopForAgent: vi.fn().mockResolvedValue(undefined),
			startForAgent: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:43123' }),
		};
		const service = new DeepSeekHarnessService(
			repository as never,
			homeService as never,
			{} as never,
			webService as never,
		);

		await service.updateForProject('agent-1', 'project-1', 'Renamed');

		expect(webService.stopForAgent).toHaveBeenCalledWith('agent-1', 'project-1');
		expect(webService.startForAgent).toHaveBeenCalledWith('agent-1', 'project-1');
		expect(homeService.renameHome).toHaveBeenCalledWith(
			'user@example.com',
			'DeepSeek Harness',
			'Renamed',
			'agent-1',
		);
	});
});
