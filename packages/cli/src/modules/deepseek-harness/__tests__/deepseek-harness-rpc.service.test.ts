import { OperationalError } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	applyFollowFrame,
	createSessionRequest,
	DeepSeekHarnessRpcService,
	textFromAssistantEvent,
} from '../deepseek-harness-rpc.service';

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
});

describe('DeepSeekHarnessRpcService', () => {
	const repository = {
		findByIdAndProjectId: vi.fn(),
	};
	const webService = {
		startForAgent: vi.fn(),
	};

	let service: DeepSeekHarnessRpcService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new DeepSeekHarnessRpcService(repository as never, webService as never);
	});

	it('allows unpublished agents when allowUnpublished is true', async () => {
		repository.findByIdAndProjectId.mockResolvedValue({
			id: 'agent-1',
			projectId: 'project-1',
			published: false,
		});
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

		await expect(service.execute('agent-1', 'project-1', 'hello', 'session-1')).rejects.toThrow(
			'stop after gate',
		);
		expect(webService.startForAgent).toHaveBeenCalledWith('agent-1', 'project-1');
	});
});
