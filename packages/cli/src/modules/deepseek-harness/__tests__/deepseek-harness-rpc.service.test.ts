import { jsonParse, OperationalError } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	applyFollowFrame,
	createSessionRequest,
	DeepSeekHarnessRpcService,
	parseHarnessQuestionRemoteEvent,
	textFromAssistantEvent,
} from '../deepseek-harness-rpc.service';

const webSocketMock = vi.hoisted(() => {
	type Listener = (value?: Buffer | Error) => void;

	class MockWebSocket {
		static instances: MockWebSocket[] = [];

		readonly sent: string[] = [];

		private readonly listeners = new Map<string, Listener[]>();

		constructor() {
			MockWebSocket.instances.push(this);
		}

		on(event: string, listener: Listener) {
			this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
			return this;
		}

		once(event: string, listener: Listener) {
			return this.on(event, listener);
		}

		send(value: string) {
			this.sent.push(value);
		}

		close() {}

		emit(event: string, value?: Buffer | Error) {
			for (const listener of this.listeners.get(event) ?? []) listener(value);
		}
	}

	return { MockWebSocket };
});

vi.mock('ws', () => ({ WebSocket: webSocketMock.MockWebSocket }));

describe('createSessionRequest', () => {
	it('binds a workflow session to the agent default workspace', () => {
		expect(createSessionRequest('session-1', 'workspace-1')).toEqual({
			request: { sessionId: 'session-1', workspaceId: 'workspace-1' },
		});
	});
});

describe('applyFollowFrame', () => {
	it('reads assistant text and turn/end from nested event frames', () => {
		expect(
			applyFollowFrame({
				type: 'event',
				event: {
					type: 'assistant/message',
					data: { message: { content: [{ type: 'text', text: '你好' }] } },
				},
			}),
		).toEqual({ text: '你好' });

		expect(
			applyFollowFrame({
				type: 'event',
				event: { type: 'turn/end' },
			}),
		).toEqual({ turnEnded: true });
	});

	it('does not treat the follow wrapper type as a wire event', () => {
		expect(applyFollowFrame({ type: 'snapshot', cursor: 0, records: [] })).toEqual({});
		expect(
			textFromAssistantEvent({
				type: 'assistant/message',
				data: { message: { content: [{ type: 'text', text: 'ok' }] } },
			}),
		).toBe('ok');
	});

	it('extracts text deltas and completion from assistant stream frames', () => {
		expect(
			applyFollowFrame({
				type: 'assistant-stream',
				frame: {
					type: 'chunk',
					chunk: { type: 'text-delta', index: 0, text: 'partial' },
				},
			}),
		).toEqual({ text: 'partial' });
		expect(
			applyFollowFrame({
				type: 'assistant-stream',
				frame: { type: 'end' },
			}),
		).toEqual({});
	});

	it('ignores the final assistant message after streaming text', () => {
		expect(
			applyFollowFrame(
				{
					type: 'event',
					event: {
						type: 'assistant/message',
						data: { message: { content: [{ type: 'text', text: 'complete response' }] } },
					},
				},
				{ hasStreamedText: true },
			),
		).toEqual({});
	});
});

describe('parseHarnessQuestionRemoteEvent', () => {
	it('parses a blocking Harness question and uses the event id as its call id', () => {
		expect(
			parseHarnessQuestionRemoteEvent({
				type: 'waterfall',
				event: 'user-questions/request',
				eventId: 'event-1',
				agentId: 'agent-runtime-1',
				request: {
					questions: [
						{
							id: 'environment',
							question: 'Choose an environment.',
							header: 'Environment',
							options: [{ label: 'Staging', description: 'Use staging.' }],
						},
					],
				},
			}),
		).toEqual({
			eventId: 'event-1',
			toolCallId: 'event-1',
			payload: {
				type: 'harness-question',
				questions: [
					{
						id: 'environment',
						question: 'Choose an environment.',
						header: 'Environment',
						options: [{ label: 'Staging', description: 'Use staging.' }],
					},
				],
			},
		});
	});

	it('uses the Harness wait call id when the request provides one', () => {
		expect(
			parseHarnessQuestionRemoteEvent({
				type: 'waterfall',
				event: 'user-questions/request',
				eventId: 'event-2',
				agentId: 'agent-runtime-1',
				request: {
					questions: [{ id: 'notes', question: 'Add notes.' }],
					wait: { callId: 'call-2' },
				},
			}),
		).toMatchObject({ eventId: 'event-2', toolCallId: 'call-2' });
	});

	it('ignores unrelated Remote Events', () => {
		expect(
			parseHarnessQuestionRemoteEvent({
				type: 'waterfall',
				event: 'permission/request',
				eventId: 'event-3',
				request: {},
			}),
		).toBeUndefined();
	});

	it('rejects a malformed Harness question request', () => {
		expect(() =>
			parseHarnessQuestionRemoteEvent({
				type: 'waterfall',
				event: 'user-questions/request',
				eventId: 'event-4',
				request: { questions: [] },
			}),
		).toThrow(OperationalError);
	});
});

describe('DeepSeekHarnessRpcService', () => {
	const repository = {
		findByIdAndProjectId: vi.fn(),
	};
	const webService = {
		startForAgent: vi.fn(),
		getConfigurationStatusForAgent: vi.fn(),
		getConfigurationStatusForRuntime: vi.fn(),
	};

	let service: DeepSeekHarnessRpcService;

	beforeEach(() => {
		vi.clearAllMocks();
		webSocketMock.MockWebSocket.instances.length = 0;
		service = new DeepSeekHarnessRpcService(repository as never, webService as never);
	});

	it('suspends a workflow when Harness asks a blocking user question', async () => {
		const sendResponseChunk = vi.fn().mockResolvedValue(undefined);
		const call = vi
			.spyOn(service as unknown as { call: (...args: unknown[]) => Promise<unknown> }, 'call')
			.mockResolvedValue(undefined);
		const operation = (
			service as unknown as {
				promptAndFollow: (
					origin: string,
					cookie: string,
					sessionId: string,
					message: string,
					sendResponseChunk: (type: string, content?: string) => Promise<void>,
					options: { supportsHitl: boolean },
				) => Promise<{ response: string; suspension?: { runId: string; toolCallId: string } }>;
			}
		).promptAndFollow('http://harness.test', 'session=1', 'session-1', 'hello', sendResponseChunk, {
			supportsHitl: true,
		});

		const socket = webSocketMock.MockWebSocket.instances[0];
		expect(socket).toBeDefined();
		socket?.emit('open');
		const opens = socket?.sent.map((frame) => jsonParse<Record<string, unknown>>(frame)) ?? [];
		expect(opens.map((frame) => frame.endpoint)).toEqual(['session/follow', '$events']);
		const followStreamId = opens[0]?.streamId;
		const eventStreamId = opens[1]?.streamId;

		socket?.emit(
			'message',
			Buffer.from(
				JSON.stringify({
					type: 'item',
					streamId: followStreamId,
					value: { type: 'snapshot', records: [] },
				}),
			),
		);
		await vi.waitFor(() =>
			expect(call).toHaveBeenCalledWith(
				'http://harness.test',
				'session=1',
				'session/prompt',
				expect.anything(),
			),
		);
		socket?.emit(
			'message',
			Buffer.from(
				JSON.stringify({
					type: 'item',
					streamId: eventStreamId,
					value: { type: 'ready', clientId: 'client-1' },
				}),
			),
		);

		socket?.emit(
			'message',
			Buffer.from(
				JSON.stringify({
					type: 'item',
					streamId: eventStreamId,
					value: {
						type: 'waterfall',
						event: 'user-questions/request',
						eventId: 'event-1',
						request: { questions: [{ id: 'environment', question: 'Choose one.' }] },
					},
				}),
			),
		);

		await expect(operation).resolves.toMatchObject({
			response: '',
			suspension: { runId: 'event-1', toolCallId: 'event-1' },
		});
		expect(sendResponseChunk.mock.calls).toEqual([['begin'], ['end']]);
	});

	it('answers a replayed Harness question and continues the same turn', async () => {
		const call = vi
			.spyOn(service as unknown as { call: (...args: unknown[]) => Promise<unknown> }, 'call')
			.mockResolvedValue(undefined);
		const operation = (
			service as unknown as {
				promptAndFollow: (
					origin: string,
					cookie: string,
					sessionId: string,
					message: string,
					sendResponseChunk: undefined,
					options: {
						supportsHitl: boolean;
						resume: { runId: string; toolCallId: string; resumeData: unknown };
					},
				) => Promise<{ response: string }>;
			}
		).promptAndFollow(
			'http://harness.test',
			'session=1',
			'session-1',
			'original prompt',
			undefined,
			{
				supportsHitl: true,
				resume: {
					runId: 'event-1',
					toolCallId: 'event-1',
					resumeData: { answers: [{ id: 'environment', selected: ['Staging'] }] },
				},
			},
		);

		const socket = webSocketMock.MockWebSocket.instances[0];
		socket?.emit('open');
		const opens = socket?.sent.map((frame) => jsonParse<Record<string, unknown>>(frame)) ?? [];
		const followStreamId = opens[0]?.streamId;
		const eventStreamId = opens[1]?.streamId;
		socket?.emit(
			'message',
			Buffer.from(
				JSON.stringify({
					type: 'item',
					streamId: followStreamId,
					value: { type: 'snapshot', records: [] },
				}),
			),
		);
		socket?.emit(
			'message',
			Buffer.from(
				JSON.stringify({
					type: 'item',
					streamId: eventStreamId,
					value: { type: 'ready', clientId: 'client-2' },
				}),
			),
		);
		socket?.emit(
			'message',
			Buffer.from(
				JSON.stringify({
					type: 'item',
					streamId: eventStreamId,
					value: {
						type: 'waterfall',
						event: 'user-questions/request',
						eventId: 'event-1',
						request: { questions: [{ id: 'environment', question: 'Choose one.' }] },
					},
				}),
			),
		);

		await vi.waitFor(() =>
			expect(call).toHaveBeenCalledWith('http://harness.test', 'session=1', '$events/result', {
				clientId: 'client-2',
				eventId: 'event-1',
				outcome: {
					kind: 'result',
					value: { answers: [{ id: 'environment', selected: ['Staging'] }] },
				},
			}),
		);
		expect(call).not.toHaveBeenCalledWith(
			'http://harness.test',
			'session=1',
			'session/prompt',
			expect.anything(),
		);
		socket?.emit(
			'message',
			Buffer.from(
				JSON.stringify({
					type: 'item',
					streamId: followStreamId,
					value: {
						type: 'event',
						event: {
							type: 'assistant/message',
							data: { message: { content: [{ type: 'text', text: 'continued' }] } },
						},
					},
				}),
			),
		);
		socket?.emit(
			'message',
			Buffer.from(
				JSON.stringify({
					type: 'item',
					streamId: followStreamId,
					value: { type: 'event', event: { type: 'turn/end' } },
				}),
			),
		);

		await expect(operation).resolves.toMatchObject({ response: 'continued' });
		expect(call).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			'userQuestions/answer',
			expect.anything(),
		);
	});

	it('keeps following a Harness turn after five minutes without events', async () => {
		vi.useFakeTimers();
		const call = vi
			.spyOn(service as unknown as { call: (...args: unknown[]) => Promise<unknown> }, 'call')
			.mockResolvedValue(undefined);
		const promptAndFollow = (
			service as unknown as {
				promptAndFollow: (
					origin: string,
					cookie: string,
					sessionId: string,
					message: string,
				) => Promise<string>;
			}
		).promptAndFollow('http://harness.test', 'session=1', 'session-1', 'hello');
		let settled = false;
		void promptAndFollow.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);

		try {
			const socket = webSocketMock.MockWebSocket.instances[0];
			expect(socket).toBeDefined();
			socket?.emit('open');
			const openFrame = jsonParse<{ streamId?: string }>(socket?.sent[0] ?? '{}');
			socket?.emit(
				'message',
				Buffer.from(
					JSON.stringify({
						type: 'item',
						streamId: openFrame.streamId,
						value: { type: 'snapshot', records: [] },
					}),
				),
			);
			await vi.advanceTimersByTimeAsync(300_001);

			expect(settled).toBe(false);

			socket?.emit(
				'message',
				Buffer.from(
					JSON.stringify({
						type: 'item',
						streamId: openFrame.streamId,
						value: {
							type: 'event',
							event: {
								type: 'assistant/message',
								data: { message: { content: [{ type: 'text', text: 'done' }] } },
							},
						},
					}),
				),
			);
			socket?.emit(
				'message',
				Buffer.from(
					JSON.stringify({
						type: 'item',
						streamId: openFrame.streamId,
						value: { type: 'event', event: { type: 'turn/end' } },
					}),
				),
			);

			await expect(promptAndFollow).resolves.toEqual({ response: 'done' });
			expect(call).toHaveBeenCalledWith('http://harness.test', 'session=1', 'session/prompt', {
				request: {
					requestId: expect.any(String),
					sessionId: 'session-1',
					mode: 'queue',
					content: [{ type: 'text', text: 'hello' }],
				},
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('allows unpublished agents when allowUnpublished is true', async () => {
		repository.findByIdAndProjectId.mockResolvedValue({
			id: 'agent-1',
			projectId: 'project-1',
			published: false,
		});
		webService.getConfigurationStatusForAgent.mockResolvedValue({ configured: true });
		webService.getConfigurationStatusForRuntime.mockResolvedValue({ configured: true });
		webService.startForAgent.mockRejectedValue(new Error('stop after gate'));

		await expect(
			service.execute('agent-1', 'project-1', 'hello', 'session-1', { allowUnpublished: true }),
		).rejects.toThrow('stop after gate');

		expect(webService.startForAgent).toHaveBeenCalledWith('agent-1', 'project-1');
	});

	it('rejects unpublished agents for production runs', async () => {
		repository.findByIdAndProjectId.mockResolvedValue({
			id: 'agent-1',
			projectId: 'project-1',
			published: false,
		});

		await expect(service.execute('agent-1', 'project-1', 'hello', 'session-1')).rejects.toThrow(
			OperationalError,
		);
		await expect(service.execute('agent-1', 'project-1', 'hello', 'session-1')).rejects.toThrow(
			/not published/,
		);
		expect(webService.startForAgent).not.toHaveBeenCalled();
	});

	it('starts published agents without allowUnpublished', async () => {
		repository.findByIdAndProjectId.mockResolvedValue({
			id: 'agent-1',
			projectId: 'project-1',
			published: true,
		});
		webService.startForAgent.mockRejectedValue(new Error('stop after gate'));
		webService.getConfigurationStatusForAgent.mockResolvedValue({ configured: true });
		webService.getConfigurationStatusForRuntime.mockResolvedValue({ configured: true });

		await expect(service.execute('agent-1', 'project-1', 'hello', 'session-1')).rejects.toThrow(
			'stop after gate',
		);
		expect(webService.startForAgent).toHaveBeenCalledWith('agent-1', 'project-1');
	});

	it('rejects configured-required execution when the Harness profile is not configured', async () => {
		repository.findByIdAndProjectId.mockResolvedValue({
			id: 'agent-1',
			projectId: 'project-1',
			published: true,
		});
		webService.getConfigurationStatusForRuntime.mockResolvedValue({ configured: false });
		webService.startForAgent.mockResolvedValue({
			url: 'http://harness.test',
			workspaceId: 'workspace-1',
		});

		await expect(service.execute('agent-1', 'project-1', 'hello', 'session-1')).rejects.toThrow(
			/Harness profile is not configured/,
		);
		expect(webService.startForAgent).toHaveBeenCalledWith('agent-1', 'project-1');
	});

	it('reuses the provided session without creating a new Harness session', async () => {
		repository.findByIdAndProjectId.mockResolvedValue({
			id: 'agent-1',
			projectId: 'project-1',
			published: false,
		});
		webService.getConfigurationStatusForAgent.mockResolvedValue({ configured: true });
		webService.getConfigurationStatusForRuntime.mockResolvedValue({ configured: true });
		webService.startForAgent.mockResolvedValue({
			url: 'http://harness.test',
			workspaceId: 'workspace-1',
		});

		const createSession = vi
			.spyOn(
				service as unknown as { createSession: (...args: unknown[]) => Promise<string> },
				'createSession',
			)
			.mockResolvedValue('created-session');
		vi.spyOn(
			service as unknown as { authenticate: (...args: unknown[]) => Promise<unknown> },
			'authenticate',
		).mockResolvedValue({ origin: 'http://harness.test', cookie: 'session=1' });
		vi.spyOn(
			service as unknown as { promptAndFollow: (...args: unknown[]) => Promise<string> },
			'promptAndFollow',
		).mockResolvedValue('ok');

		const result = await service.execute('agent-1', 'project-1', 'retry', 'existing-session', {
			allowUnpublished: true,
			reuseSession: true,
		});

		expect(result.session?.sessionId).toBe('existing-session');
		expect(createSession).not.toHaveBeenCalled();
	});

	it('checks configuration through the runtime that was already started', async () => {
		repository.findByIdAndProjectId.mockResolvedValue({
			id: 'agent-1',
			projectId: 'project-1',
			published: false,
		});
		webService.startForAgent.mockResolvedValue({
			url: 'http://harness.test',
			workspaceId: 'workspace-1',
		});
		webService.getConfigurationStatusForRuntime.mockResolvedValue({ configured: false });

		await expect(
			service.execute('agent-1', 'project-1', 'hello', 'session-1', { allowUnpublished: true }),
		).rejects.toThrow(/not configured/);

		expect(webService.getConfigurationStatusForAgent).not.toHaveBeenCalled();
		expect(webService.getConfigurationStatusForRuntime).toHaveBeenCalledWith('http://harness.test');
	});
});
