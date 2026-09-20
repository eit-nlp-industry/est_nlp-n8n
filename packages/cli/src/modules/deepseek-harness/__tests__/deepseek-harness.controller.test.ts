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

		expect(service.createForProject).toHaveBeenCalledWith(
			'user@example.com',
			'project-1',
		);
	});

	it('deletes an agent for the requested project', async () => {
		const service = { deleteForProject: vi.fn().mockResolvedValue(true) };
		const controller = new DeepSeekHarnessController(service as never);

		await expect(
			controller.delete(
				{ params: { projectId: 'project-1' } } as never,
				{} as never,
				'agent-1',
			),
		).resolves.toEqual({ success: true });

		expect(service.deleteForProject).toHaveBeenCalledWith('agent-1', 'project-1');
	});

	it('updates an agent name for the requested project', async () => {
		const service = {
			updateForProject: vi.fn().mockResolvedValue({ id: 'agent-1', name: 'Renamed' }),
		};
		const controller = new DeepSeekHarnessController(service as never);

		await expect(
			controller.update(
				{ params: { projectId: 'project-1' } } as never,
				{} as never,
				'agent-1',
				{ name: 'Renamed' } as never,
			),
		).resolves.toEqual({ id: 'agent-1', name: 'Renamed' });

		expect(service.updateForProject).toHaveBeenCalledWith('agent-1', 'project-1', 'Renamed');
	});
});
