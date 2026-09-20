import { vi } from 'vitest';

import { DeepSeekHarnessService } from '../deepseek-harness.service';

describe('DeepSeekHarnessService', () => {
	it('creates a project-scoped agent and its isolated home', async () => {
		const repository = {
			create: vi.fn((data) => data),
			save: vi.fn(async (agent) => agent),
			findStartingWith: vi.fn().mockResolvedValue([]),
		};
		const homeService = {
			createHome: vi.fn(async () => 'C:/dsh/user@example.com/Research agent-agent-1'),
			removeHome: vi.fn(async () => {}),
		};
		const service = new DeepSeekHarnessService(repository as never, homeService as never);

		const result = await service.createForProject('user@example.com', 'project-1');

		expect(result.name).toBe('DeepSeek Harness');
		expect(result.projectId).toBe('project-1');
		expect(result.status).toBe('created');
		expect(homeService.createHome).toHaveBeenCalledWith(
			'user@example.com',
			'DeepSeek Harness',
			result.id,
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
			create: vi.fn((data) => data),
			save: vi.fn(async () => {
				throw new Error('database unavailable');
			}),
			findStartingWith: vi.fn().mockResolvedValue([]),
		};
		const homeService = {
			createHome: vi.fn(async () => 'C:/dsh/user@example.com/Research agent-agent-1'),
			removeHome: vi.fn(async () => {}),
		};
		const service = new DeepSeekHarnessService(repository as never, homeService as never);

		await expect(
			service.createForProject('user@example.com', 'project-1'),
		).rejects.toThrow(
			'database unavailable',
		);
		expect(homeService.removeHome).toHaveBeenCalledWith(
			'user@example.com',
			'DeepSeek Harness',
			expect.any(String),
		);
	});

	it('uses the next workflow-style suffix for an existing default name', async () => {
		const repository = {
			create: vi.fn((data) => data),
			save: vi.fn(async (agent) => agent),
			findStartingWith: vi
				.fn()
				.mockResolvedValue([{ name: 'DeepSeek Harness' }, { name: 'DeepSeek Harness 2' }]),
		};
		const homeService = {
			createHome: vi.fn(async () => 'C:/dsh/user@example.com/DeepSeek Harness 3-agent-1'),
			removeHome: vi.fn(async () => {}),
		};
		const service = new DeepSeekHarnessService(repository as never, homeService as never);

		const result = await service.createForProject('user@example.com', 'project-1');

		expect(result.name).toBe('DeepSeek Harness 3');
		expect(repository.findStartingWith).toHaveBeenCalledWith('DeepSeek Harness');
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
		const homeService = { removeHome: vi.fn().mockResolvedValue(undefined) };
		const service = new DeepSeekHarnessService(repository as never, homeService as never);

		await expect(service.deleteForProject('agent-1', 'project-1')).resolves.toBe(true);

		expect(repository.deleteByIdAndProjectId).toHaveBeenCalledWith('agent-1', 'project-1');
		expect(homeService.removeHome).toHaveBeenCalledWith(
		'user@example.com',
		'Research agent',
		'agent-1',
		);
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
		const homeService = { removeLegacyHome: vi.fn().mockResolvedValue(undefined) };
		const service = new DeepSeekHarnessService(repository as never, homeService as never);

		await expect(service.deleteForProject('agent-1', 'project-1')).resolves.toBe(true);

		expect(homeService.removeLegacyHome).toHaveBeenCalledWith('agent-1');
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
		const homeService = { renameHome: vi.fn().mockResolvedValue(undefined) };
		const service = new DeepSeekHarnessService(repository as never, homeService as never);

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
});
