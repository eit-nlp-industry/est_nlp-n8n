import { DeepSeekHarnessController } from '../deepseek-harness.controller';

describe('DeepSeekHarnessController', () => {
	it('creates an agent for the requested project', async () => {
		const service = {
			createForProject: vi.fn().mockResolvedValue({ id: 'agent-1', name: 'Research' }),
		};
		const controller = new DeepSeekHarnessController(service as never);

		await controller.create(
			{ params: { projectId: 'project-1' }, user: { email: 'user@example.com' } } as never,
			{} as never,
			{} as never,
		);

		expect(service.createForProject).toHaveBeenCalledWith('user@example.com', 'project-1');
	});

	it('deletes an agent for the requested project', async () => {
		const service = { deleteForProject: vi.fn().mockResolvedValue(true) };
		const controller = new DeepSeekHarnessController(service as never);

		await expect(
			controller.delete({ params: { projectId: 'project-1' } } as never, {} as never, 'agent-1'),
		).resolves.toEqual({ success: true });

		expect(service.deleteForProject).toHaveBeenCalledWith('agent-1', 'project-1');
	});

	it('updates an agent name for the requested project', async () => {
		const service = {
			updateForProject: vi.fn().mockResolvedValue({ id: 'agent-1', name: 'Renamed' }),
		};
		const controller = new DeepSeekHarnessController(service as never);

		await expect(
			controller.update({ params: { projectId: 'project-1' } } as never, {} as never, 'agent-1', {
				name: 'Renamed',
			} as never),
		).resolves.toEqual({ id: 'agent-1', name: 'Renamed' });

		expect(service.updateForProject).toHaveBeenCalledWith('agent-1', 'project-1', 'Renamed');
	});

	it('starts the native Studio for the requested project agent', async () => {
		const service = {
			startStudioForProject: vi
				.fn()
				.mockResolvedValue({ url: '/deepseek-harness-studio/project-1/agent-1/?token=x' }),
		};
		const controller = new DeepSeekHarnessController(service as never);

		await expect(
			controller.studio({ params: { projectId: 'project-1' } } as never, {} as never, 'agent-1'),
		).resolves.toEqual({ url: '/deepseek-harness-studio/project-1/agent-1/?token=x' });

		expect(service.startStudioForProject).toHaveBeenCalledWith('agent-1', 'project-1');
	});

	it('restarts the native Studio for the requested project agent', async () => {
		const service = {
			restartStudioForProject: vi
				.fn()
				.mockResolvedValue({ url: '/deepseek-harness-studio/project-1/agent-1/?token=y' }),
		};
		const controller = new DeepSeekHarnessController(service as never);

		await expect(
			controller.restart({ params: { projectId: 'project-1' } } as never, {} as never, 'agent-1'),
		).resolves.toEqual({ url: '/deepseek-harness-studio/project-1/agent-1/?token=y' });

		expect(service.restartStudioForProject).toHaveBeenCalledWith('agent-1', 'project-1');
	});

	it('publishes the requested project agent', async () => {
		const service = {
			publishForProject: vi.fn().mockResolvedValue({ id: 'agent-1', published: true }),
		};
		const controller = new DeepSeekHarnessController(service as never);

		await expect(
			controller.publish({ params: { projectId: 'project-1' } } as never, {} as never, 'agent-1'),
		).resolves.toEqual({ id: 'agent-1', published: true });
		expect(service.publishForProject).toHaveBeenCalledWith('agent-1', 'project-1');
	});

	it('unpublishes the requested project agent', async () => {
		const service = {
			unpublishForProject: vi.fn().mockResolvedValue({ id: 'agent-1', published: false }),
		};
		const controller = new DeepSeekHarnessController(service as never);

		await expect(
			controller.unpublish({ params: { projectId: 'project-1' } } as never, {} as never, 'agent-1'),
		).resolves.toEqual({ id: 'agent-1', published: false });
		expect(service.unpublishForProject).toHaveBeenCalledWith('agent-1', 'project-1');
	});
});
