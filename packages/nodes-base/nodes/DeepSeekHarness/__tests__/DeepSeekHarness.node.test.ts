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
		expect(node.description.properties.some((property) => property.name === 'sessionId')).toBe(
			false,
		);
		expect(node.description.properties.some((property) => property.name === 'advanced')).toBe(true);
		expect(workspace?.displayOptions).toEqual({ show: { specifyWorkspace: [true] } });
	});

	it('uses the default workspace unless workspace selection is enabled', async () => {
		const node = new DeepSeekHarness();
		const executeAgent = vi.fn().mockResolvedValue({
			response: 'done',
			session: {
				agentId: 'dsh-1',
				projectId: 'project-1',
				sessionId: 'session-1',
				threadId: 'session-1',
			},
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
			session: {
				agentId: 'dsh-1',
				projectId: 'project-1',
				sessionId: 'session-1',
				threadId: 'session-1',
			},
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
			session: {
				agentId: 'dsh-1',
				projectId: 'project-1',
				sessionId: 'session-1',
				threadId: 'session-1',
			},
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
			session: {
				agentId: 'dsh-1',
				projectId: 'project-1',
				sessionId: 'session-1',
				threadId: 'session-1',
			},
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

	it('parks the workflow with a Harness question and preserves completed items', async () => {
		const node = new DeepSeekHarness();
		const executeAgent = vi
			.fn()
			.mockResolvedValueOnce({
				response: 'first done',
				session: {
					agentId: 'dsh-1',
					projectId: 'project-1',
					sessionId: 'chat-session',
					threadId: 'chat-session',
				},
			})
			.mockResolvedValueOnce({
				response: '',
				session: {
					agentId: 'dsh-1',
					projectId: 'project-1',
					sessionId: 'chat-session',
					threadId: 'chat-session',
				},
				suspension: {
					agentId: 'dsh-1',
					threadId: 'chat-session',
					suspensions: [
						{
							runId: 'event-1',
							toolCallId: 'event-1',
							toolName: 'ask_user_question',
							suspendPayload: {
								type: 'harness-question',
								questions: [{ id: 'environment', question: 'Choose one.' }],
							},
						},
					],
				},
			});
		const setMetadata = vi.fn();
		const putExecutionToWait = vi.fn();
		const context = {
			getInputData: () => [{ json: { value: 1 } }, { json: { value: 2 } }],
			getExecutionId: () => 'execution-1',
			getExecuteData: () => ({ metadata: {} }),
			getExecutionContext: () => ({
				source: 'manual',
				triggerNode: { name: 'Chat Trigger', type: '@n8n/n8n-nodes-langchain.chatTrigger' },
			}),
			getChatTrigger: () => ({
				name: 'Chat Trigger',
				type: '@n8n/n8n-nodes-langchain.chatTrigger',
			}),
			evaluateExpression: () => 'chat-session',
			getNodeParameter: (name: string) => {
				if (name === 'agentId') return { value: 'dsh-1' };
				if (name === 'message') return 'hello';
				if (name === 'advanced') return { session: { sessionIdType: 'fromInput' } };
				return '';
			},
			executeAgent,
			setMetadata,
			putExecutionToWait,
			getNode: () => ({ name: 'Harness', type: 'n8n-nodes-base.deepSeekHarness' }),
		} as never;

		const result = await node.execute.call(context);

		expect(result[0]).toEqual([
			{ json: { text: 'first done', session: expect.any(Object) }, pairedItem: { item: 0 } },
			{
				json: {},
				sendMessage: {
					type: 'agent-interaction',
					interaction: {
						runId: 'event-1',
						toolCallId: 'event-1',
						interactionType: 'harness_question',
						payload: {
							type: 'harness-question',
							questions: [{ id: 'environment', question: 'Choose one.' }],
						},
						blockUserInput: true,
					},
				},
				pairedItem: { item: 1 },
			},
		]);
		expect(setMetadata).toHaveBeenCalledWith({
			deepSeekHarnessWorkflowSuspension: expect.objectContaining({
				itemIndex: 1,
				sessionId: 'chat-session',
				completedItems: [
					{ json: { text: 'first done', session: expect.any(Object) }, pairedItem: { item: 0 } },
				],
			}),
		});
		expect(putExecutionToWait).toHaveBeenCalledOnce();
		expect(executeAgent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ supportsHitl: true, sessionId: 'chat-session' }),
			'hello',
			'execution-1',
			1,
		);
	});

	it('stores a matching Harness answer for workflow resume', async () => {
		const node = new DeepSeekHarness();
		const setMetadata = vi.fn();
		const waiting = {
			agentId: 'dsh-1',
			sessionId: 'chat-session',
			itemIndex: 0,
			completedItems: [],
			suspension: {
				runId: 'event-1',
				toolCallId: 'event-1',
				toolName: 'ask_user_question',
				suspendPayload: {},
			},
		};
		const context = {
			getExecuteData: () => ({ metadata: { deepSeekHarnessWorkflowSuspension: waiting } }),
			setMetadata,
			getNode: () => ({ name: 'Harness', type: 'n8n-nodes-base.deepSeekHarness' }),
		} as never;
		const data = {
			json: {
				chatInput: JSON.stringify({
					type: 'agent-suspension-response',
					runId: 'event-1',
					toolCallId: 'event-1',
					resumeData: { answers: [{ id: 'environment', selected: ['Staging'] }] },
				}),
			},
		};

		await node.onMessage.call(context, context, data as never);

		expect(setMetadata).toHaveBeenCalledWith({
			deepSeekHarnessWorkflowSuspension: {
				...waiting,
				resumeCommand: {
					runId: 'event-1',
					toolCallId: 'event-1',
					resumeData: { answers: [{ id: 'environment', selected: ['Staging'] }] },
				},
			},
		});
	});

	it('uses a resume command only for the suspended input item', async () => {
		const node = new DeepSeekHarness();
		const executeAgent = vi.fn().mockResolvedValue({
			response: 'done',
			session: {
				agentId: 'dsh-1',
				projectId: 'project-1',
				sessionId: 'chat-session',
				threadId: 'chat-session',
			},
		});
		const resumeCommand = {
			runId: 'event-1',
			toolCallId: 'event-1',
			resumeData: { answers: [{ id: 'environment', selected: ['Staging'] }] },
		};
		const context = {
			getInputData: () => [{ json: { value: 1 } }, { json: { value: 2 } }],
			getExecutionId: () => 'execution-1',
			getExecuteData: () => ({
				metadata: {
					deepSeekHarnessWorkflowSuspension: {
						agentId: 'dsh-1',
						sessionId: 'chat-session',
						itemIndex: 0,
						completedItems: [],
						suspension: {
							runId: 'event-1',
							toolCallId: 'event-1',
							toolName: 'ask_user_question',
							suspendPayload: {},
						},
						resumeCommand,
					},
				},
			}),
			getExecutionContext: () => ({
				source: 'manual',
				triggerNode: { name: 'Chat Trigger', type: '@n8n/n8n-nodes-langchain.chatTrigger' },
			}),
			getChatTrigger: () => ({
				name: 'Chat Trigger',
				type: '@n8n/n8n-nodes-langchain.chatTrigger',
			}),
			evaluateExpression: () => 'chat-session',
			getNodeParameter: (name: string) => {
				if (name === 'agentId') return { value: 'dsh-1' };
				if (name === 'message') return 'hello';
				return '';
			},
			executeAgent,
			setMetadata: vi.fn(),
			getNode: () => ({ name: 'Harness', type: 'n8n-nodes-base.deepSeekHarness' }),
		} as never;

		await node.execute.call(context);

		expect(executeAgent).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ resume: resumeCommand }),
			'hello',
			'execution-1',
			0,
		);
		expect(executeAgent.mock.calls[1]?.[0]).not.toHaveProperty('resume');
	});
});
