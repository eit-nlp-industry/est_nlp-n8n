import { describe, expect, it, vi } from 'vitest';

import { DeepSeekHarness } from '../DeepSeekHarness.node';

describe('DeepSeekHarness node', () => {
	it('exposes a searchable agent selector and message field', () => {
		const node = new DeepSeekHarness();
		const agent = node.description.properties.find((property) => property.name === 'agentId');
		const workspace = node.description.properties.find((property) => property.name === 'workspace');

		expect(agent?.type).toBe('resourceLocator');
		expect(agent?.modes?.[0]?.typeOptions?.searchListMethod).toBe('listDeepSeekHarnessAgents');
		expect(node.description.properties.some((property) => property.name === 'message')).toBe(true);
		expect(node.description.properties.some((property) => property.name === 'sessionId')).toBe(false);
		expect(node.description.properties.some((property) => property.name === 'advanced')).toBe(true);
		expect(workspace?.displayOptions).toEqual({ show: { specifyWorkspace: [true] } });
	});

	it('uses the default workspace unless workspace selection is enabled', async () => {
		const node = new DeepSeekHarness();
		const executeAgent = vi.fn().mockResolvedValue({
			response: 'done',
			session: { agentId: 'dsh-1', projectId: 'project-1', sessionId: 'session-1', threadId: 'session-1' },
		});
		const context = {
			getInputData: () => [{ json: {} }],
			getExecutionId: () => 'execution-1',
			getNodeParameter: (name: string) => {
				if (name === 'agentId') return { value: 'dsh-1' };
				if (name === 'message') return 'hello';
				if (name === 'specifyWorkspace') return false;
				if (name === 'workspace') return { value: 'workspace-2' };
				return '';
			},
			executeAgent,
			getNode: () => ({ name: 'Harness', type: 'n8n-nodes-base.deepSeekHarness' }),
		} as never;

		await node.execute.call(context);

		expect(executeAgent).toHaveBeenCalledWith(
			{ deepSeekHarnessAgentId: 'dsh-1' },
			'hello',
			'execution-1',
			0,
		);
	});

	it('passes the selected workspace when workspace selection is enabled', async () => {
		const node = new DeepSeekHarness();
		const executeAgent = vi.fn().mockResolvedValue({
			response: 'done',
			session: { agentId: 'dsh-1', projectId: 'project-1', sessionId: 'session-1', threadId: 'session-1' },
		});
		const context = {
			getInputData: () => [{ json: {} }],
			getExecutionId: () => 'execution-1',
			getNodeParameter: (name: string) => {
				if (name === 'agentId') return { value: 'dsh-1' };
				if (name === 'message') return 'hello';
				if (name === 'specifyWorkspace') return true;
				if (name === 'workspace') return { value: 'workspace-2' };
				return '';
			},
			executeAgent,
			getNode: () => ({ name: 'Harness', type: 'n8n-nodes-base.deepSeekHarness' }),
		} as never;

		await node.execute.call(context);

		expect(executeAgent).toHaveBeenCalledWith(
			{ deepSeekHarnessAgentId: 'dsh-1', workspaceId: 'workspace-2' },
			'hello',
			'execution-1',
			0,
		);
	});

	it('sends each input item to the selected Harness agent', async () => {
		const node = new DeepSeekHarness();
		const executeAgent = vi.fn().mockResolvedValue({
			response: 'done',
			session: { agentId: 'dsh-1', projectId: 'project-1', sessionId: 'session-1', threadId: 'session-1' },
		});
		const context = {
			getInputData: () => [{ json: { value: 1 } }, { json: { value: 2 } }],
			getExecutionId: () => 'execution-1',
			getNodeParameter: (name: string) => {
				if (name === 'agentId') return { value: 'dsh-1' };
				if (name === 'message') return 'hello';
				return '';
			},
			executeAgent,
			getNode: () => ({ name: 'Harness', type: 'n8n-nodes-base.deepSeekHarness' }),
		} as never;

		const result = await node.execute.call(context);

		expect(executeAgent).toHaveBeenCalledTimes(2);
		expect(executeAgent).toHaveBeenNthCalledWith(
		1,
		{ deepSeekHarnessAgentId: 'dsh-1' },
		'hello',
		'execution-1',
		0,
		);
		expect(result[0]).toEqual([
			{ json: { text: 'done', session: expect.any(Object) }, pairedItem: { item: 0 } },
			{ json: { text: 'done', session: expect.any(Object) }, pairedItem: { item: 1 } },
		]);
	});

	it('disables streaming only when explicitly disabled', async () => {
		const node = new DeepSeekHarness();
		const executeAgent = vi.fn().mockResolvedValue({
			response: 'done',
			session: { agentId: 'dsh-1', projectId: 'project-1', sessionId: 'session-1', threadId: 'session-1' },
		});
		const context = {
			getInputData: () => [{ json: {} }],
			getExecutionId: () => 'execution-1',
			getNodeParameter: (name: string) => {
				if (name === 'agentId') return { value: 'dsh-1' };
				if (name === 'message') return 'hello';
				if (name === 'advanced') return { enableStreaming: false };
				return '';
			},
			executeAgent,
			getNode: () => ({ name: 'Harness', type: 'n8n-nodes-base.deepSeekHarness' }),
		} as never;

		await node.execute.call(context);

		expect(executeAgent).toHaveBeenCalledWith(
			{ deepSeekHarnessAgentId: 'dsh-1', enableStreaming: false },
			'hello',
			'execution-1',
			0,
		);
	});
});
