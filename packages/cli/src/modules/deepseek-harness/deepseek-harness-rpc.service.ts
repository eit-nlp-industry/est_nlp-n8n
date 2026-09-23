import { Service } from '@n8n/di';
import { OperationalError, type ChunkType, type ExecuteAgentData } from 'n8n-workflow';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';

import { DeepSeekHarnessWebService } from './deepseek-harness-web.service';
import { DeepSeekHarnessAgentRepository } from './repositories/deepseek-harness-agent.repository';

const TURN_TIMEOUT_MS = 120_000;
const RPC_TIMEOUT_MS = 30_000;
type Fetch = typeof fetch;

type TextBlock = { type?: string; text?: string };

type HarnessEventRecord = {
	type?: string;
	data?: Record<string, unknown>;
};

type HarnessWireEvent = {
	type?: string;
	data?: HarnessEventRecord['data'] & {
		message?: {
			content?: TextBlock[];
		};
	};
};

type HarnessAssistantStreamFrame =
	| { type: 'start' }
	| { type: 'chunk'; chunk: { type?: string; index?: number; text?: string } }
	| { type: 'end' };

/** Mux `item` payload for `session/follow` (see DeepSeek Harness SessionFollowFrame). */
type SessionFollowFrame =
	| { type: 'snapshot'; cursor?: number; records?: Array<{ type?: string; event?: HarnessWireEvent }> }
	| { type: 'event'; event: HarnessWireEvent }
	| { type: 'assistant-stream'; frame: HarnessAssistantStreamFrame };

type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } };

type StreamResponseChunk = (type: ChunkType, content?: string) => Promise<void>;

export function createSessionRequest(sessionId: string, workspaceId: string) {
	return { request: { sessionId, workspaceId } };
}

export function textFromAssistantEvent(event: HarnessWireEvent): string {
	return (
		event.data?.message?.content
			?.filter((block) => block.type === 'text')
			.map((block) => block.text ?? '')
			.join('') ?? ''
	);
}

/** Apply one follow-stream frame. Returns text to append and whether the turn ended. */
export function applyFollowFrame(
	frame: SessionFollowFrame,
): { text?: string; turnEnded?: boolean } {
	if (frame.type === 'event' && frame.event) {
		const event = frame.event;
		if (event.type === 'assistant/message') return { text: textFromAssistantEvent(event) };
		if (event.type === 'turn/end') return { turnEnded: true };
		return {};
	}

	if (frame.type === 'assistant-stream') {
		if (frame.frame.type === 'chunk' && frame.frame.chunk.type === 'text-delta') {
			return { text: frame.frame.chunk.text ?? '' };
		}
		return {};
	}

	if (frame.type === 'snapshot' && Array.isArray(frame.records)) {
		let text = '';
		let turnEnded = false;
		for (const record of frame.records) {
			if (record.type !== 'event' || !record.event) continue;
			if (record.event.type === 'assistant/message') text += textFromAssistantEvent(record.event);
			if (record.event.type === 'turn/end') turnEnded = true;
		}
		return { text: text || undefined, turnEnded: turnEnded || undefined };
	}

	return {};
}

@Service()
export class DeepSeekHarnessRpcService {
	constructor(
		private readonly repository: DeepSeekHarnessAgentRepository,
		private readonly webService: DeepSeekHarnessWebService,
		private readonly fetchFn: Fetch = fetch,
	) {}

	async execute(
		agentId: string,
		projectId: string,
		message: string,
		sessionId: string,
		options: {
			allowUnpublished?: boolean;
			sendResponseChunk?: StreamResponseChunk;
			workspaceId?: string;
		} = {},
	): Promise<ExecuteAgentData> {
		const agent = await this.repository.findByIdAndProjectId(agentId, projectId);
		if (!agent) throw new OperationalError('DeepSeek Harness agent was not found');
		// Align with built-in Agents: manual/chat may run drafts; production needs publish.
		if (!agent.published && !options.allowUnpublished) {
			throw new OperationalError(
				'DeepSeek Harness agent is not published. Publish the agent before using it in a production workflow.',
			);
		}

		const runtime = await this.webService.startForAgent(agentId, projectId);
		const { origin, cookie } = await this.authenticate(runtime.url);
		const actualSessionId = await this.createSession(
			origin,
			cookie,
			sessionId,
			options.workspaceId && options.workspaceId !== 'empty-workspace'
				? options.workspaceId
				: runtime.workspaceId,
		);
		const response = await this.promptAndFollow(
			origin,
			cookie,
			actualSessionId,
			message,
			options.sendResponseChunk,
		);

		return {
			response,
			structuredOutput: null,
			usage: null,
			toolCalls: [],
			finishReason: 'completed',
			session: {
				agentId,
				projectId,
				sessionId: actualSessionId,
				threadId: actualSessionId,
			},
		};
	}

	private async authenticate(runtimeUrl: string): Promise<{ origin: string; cookie: string }> {
		const response = await this.fetchFn(runtimeUrl, {
			redirect: 'manual',
			signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
		});
		const setCookie = response.headers.get('set-cookie');
		if (response.status !== 303 || !setCookie) {
			throw new OperationalError('DeepSeek Harness Web authentication failed');
		}

		return {
			origin: new URL(runtimeUrl).origin,
			cookie: setCookie.split(';', 1)[0] ?? '',
		};
	}

	private async call<T>(origin: string, cookie: string, endpoint: string, args: object): Promise<T> {
		const rpcId = `n8n-${crypto.randomUUID()}`;
		const response = await this.fetchFn(`${origin}/api/${endpoint}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie },
			signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
			body: JSON.stringify({
				type: 'client-request',
				rpcId,
				method: endpoint,
				payload: { args },
			}),
		});
		if (!response.ok) throw new OperationalError(`DeepSeek Harness ${endpoint} failed`);

		const body = (await response.json()) as { result?: RpcResult<T> };
		if (!body.result?.ok) {
			throw new OperationalError(body.result?.error.message ?? `DeepSeek Harness ${endpoint} failed`);
		}
		return body.result.value;
	}

	private async createSession(
		origin: string,
		cookie: string,
		sessionId: string,
		workspaceId: string,
	): Promise<string> {
		const result = await this.call<{ sessionId: string }>(origin, cookie, 'session/create', {
			...createSessionRequest(sessionId, workspaceId),
		});
		return result.sessionId;
	}

	private async promptAndFollow(
		origin: string,
		cookie: string,
		sessionId: string,
		message: string,
		sendResponseChunk?: StreamResponseChunk,
	): Promise<string> {
		return await new Promise<string>((resolve, reject) => {
			const socket = new WebSocket(`${origin.replace(/^http/u, 'ws')}/api/remote.mux`, {
				headers: { cookie },
			});
			const streamId = `n8n-${crypto.randomUUID()}`;
			let response = '';
			let settled = false;
			let followReady = false;
			let streamedText = false;
			const timer = setTimeout(
				() => finish(new OperationalError('DeepSeek Harness response timed out')),
				TURN_TIMEOUT_MS,
			);

			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				socket.close();
				if (error) reject(error);
				else resolve(response);
			};

			const sendPrompt = () => {
				void this.call(origin, cookie, 'session/prompt', {
					request: {
						requestId: crypto.randomUUID(),
						sessionId,
						mode: 'queue',
						content: [{ type: 'text', text: message }],
					},
				}).catch((error: unknown) =>
					finish(error instanceof Error ? error : new Error(String(error))),
				);
			};

			socket.once('open', () => {
				socket.send(
					JSON.stringify({
						type: 'open',
						streamId,
						endpoint: 'session/follow',
						payload: {
							args: {
								request: {
									address: { kind: 'session', sessionId },
									...(sendResponseChunk ? { assistantStream: true } : {}),
								},
							},
						},
					}),
				);
			});
			socket.on('message', async (raw: Buffer | string) => {
				try {
					const frame = JSON.parse(raw.toString()) as {
						type?: string;
						streamId?: string;
						value?: SessionFollowFrame;
						error?: { message?: string };
					};
					if (frame.streamId !== undefined && frame.streamId !== streamId) return;
					if (frame.type === 'error') {
						finish(new OperationalError(frame.error?.message ?? 'DeepSeek Harness stream failed'));
						return;
					}
					if (frame.type !== 'item' || !frame.value) return;

					const follow = frame.value;
					if (!followReady) {
						if (follow.type !== 'snapshot') return;
						followReady = true;
						if (sendResponseChunk) await sendResponseChunk('begin');
						sendPrompt();
						return;
					}

					const applied = applyFollowFrame(follow);
					if (applied.text) {
						response += applied.text;
						streamedText = true;
						if (sendResponseChunk) await sendResponseChunk('item', applied.text);
					}
					if (applied.turnEnded) {
						if (sendResponseChunk && response.length > 0 && !streamedText) {
							await sendResponseChunk('item', response);
						}
						if (sendResponseChunk) await sendResponseChunk('end');
						finish();
					}
				} catch (error) {
					finish(error instanceof Error ? error : new Error(String(error)));
				}
			});
			socket.once('error', (error) => finish(error));
			socket.once('close', () => {
				if (!settled) finish(new OperationalError('DeepSeek Harness stream closed unexpectedly'));
			});
		});
	}
}
