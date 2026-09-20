import { vi } from 'vitest';

import { makeRestApiRequest } from '@n8n/rest-api-client';

import { useDeepSeekHarnessApi } from '../composables/useDeepSeekHarnessApi';

vi.mock('@n8n/rest-api-client', () => ({
	makeRestApiRequest: vi.fn(),
}));

vi.mock('@n8n/stores/useRootStore', () => ({
	useRootStore: () => ({ restApiContext: { baseUrl: '/rest', pushRef: 'push-ref' } }),
}));

describe('useDeepSeekHarnessApi', () => {
	it('deletes an agent for a project', async () => {
		const { deleteAgent } = useDeepSeekHarnessApi();

		await deleteAgent('project-1', 'agent-1');

		expect(makeRestApiRequest).toHaveBeenCalledWith(
			{ baseUrl: '/rest', pushRef: 'push-ref' },
			'DELETE',
			'/projects/project-1/deepseek-harness/agents/agent-1',
		);
	});

	it('lists agents for a project', async () => {
		vi.mocked(makeRestApiRequest).mockResolvedValueOnce([]);

		const { listAgents } = useDeepSeekHarnessApi();

		await listAgents('project-1');

		expect(makeRestApiRequest).toHaveBeenCalledWith(
			{ baseUrl: '/rest', pushRef: 'push-ref' },
			'GET',
			'/projects/project-1/deepseek-harness/agents',
		);
	});
});
