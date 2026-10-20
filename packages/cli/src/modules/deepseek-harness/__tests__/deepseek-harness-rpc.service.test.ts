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
		getConfigurationStatusForAgent: vi.fn(),
		getConfigurationStatusForRuntime: vi.fn(),
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
		webService.startForAgent.mockResolvedValue({ url: 'http://harness.test', workspaceId: 'workspace-1' });

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
		webService.startForAgent.mockResolvedValue({ url: 'http://harness.test', workspaceId: 'workspace-1' });

		const createSession = vi
			.spyOn(service as unknown as { createSession: (...args: unknown[]) => Promise<string> }, 'createSession')
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
		webService.startForAgent.mockResolvedValue({ url: 'http://harness.test', workspaceId: 'workspace-1' });
		webService.getConfigurationStatusForRuntime.mockResolvedValue({ configured: false });

		await expect(
			service.execute('agent-1', 'project-1', 'hello', 'session-1', { allowUnpublished: true }),
		).rejects.toThrow(/not configured/);

		expect(webService.getConfigurationStatusForAgent).not.toHaveBeenCalled();
		expect(webService.getConfigurationStatusForRuntime).toHaveBeenCalledWith('http://harness.test');
	});
});
