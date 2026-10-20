import { Service } from '@n8n/di';
import { isRecord } from '@n8n/utils/is-record';
import {
	OperationalError,
	type AgentWorkflowSuspension,
	type ChunkType,
	type ExecuteAgentData,
	type ExecuteAgentResume,
} from 'n8n-workflow';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';

import { DeepSeekHarnessWebService } from './deepseek-harness-web.service';
import { DeepSeekHarnessAgentRepository } from './repositories/deepseek-harness-agent.repository';

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
	| {
			type: 'snapshot';
			cursor?: number;
			records?: Array<{ type?: string; event?: HarnessWireEvent }>;
	  }
	| { type: 'event'; event: HarnessWireEvent }
	| { type: 'assistant-stream'; frame: HarnessAssistantStreamFrame };

type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } };

type StreamResponseChunk = (type: ChunkType, content?: string) => Promise<void>;

interface HarnessFollowResult {
	response: string;
	suspension?: AgentWorkflowSuspension;
}

interface HarnessFollowOptions {
	supportsHitl?: boolean;
	resume?: ExecuteAgentResume;
}

interface HarnessQuestion {
	id: string;
	question: string;
	detail?: string;
	header?: string;
	options?: Array<{ label: string; description?: string }>;
	multiSelect?: boolean;
}

interface HarnessQuestionInteractionPayload {
	type: 'harness-question';
	questions: HarnessQuestion[];
}

function isSessionFollowFrame(value: unknown): value is SessionFollowFrame {
	return (
		isRecord(value) &&
		(value.type === 'snapshot' || value.type === 'event' || value.type === 'assistant-stream')
	);
}

export interface HarnessQuestionRemoteEvent {
	eventId: string;
	toolCallId: string;
	payload: HarnessQuestionInteractionPayload;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === 'string' ? value : undefined;
}

function projectHarnessQuestion(value: unknown): HarnessQuestion | undefined {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		value.id.length === 0 ||
		typeof value.question !== 'string' ||
		value.question.length === 0
	) {
		return undefined;
	}
	const options = Array.isArray(value.options)
		? value.options.flatMap((option) => {
				if (!isRecord(option) || typeof option.label !== 'string' || option.label.length === 0) {
					return [];
				}
				return [
					{
						label: option.label,
						...(typeof option.description === 'string' ? { description: option.description } : {}),
					},
				];
			})
		: undefined;

	return {
		id: value.id,
		question: value.question,
		...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
		...(typeof value.header === 'string' ? { header: value.header } : {}),
		...(options ? { options } : {}),
		...(typeof value.multiSelect === 'boolean' ? { multiSelect: value.multiSelect } : {}),
	};
}

export function parseHarnessQuestionRemoteEvent(
	value: unknown,
): HarnessQuestionRemoteEvent | undefined {
	if (!isRecord(value) || value.type !== 'waterfall') return undefined;
	if (value.event !== 'user-questions/request') return undefined;
	if (typeof value.eventId !== 'string' || !isRecord(value.request)) {
		throw new OperationalError('DeepSeek Harness sent an invalid user question request');
	}

	const rawQuestions = Array.isArray(value.request.questions) ? value.request.questions : [];
	const questions = rawQuestions.flatMap((question) => {
		const projected = projectHarnessQuestion(question);
		return projected ? [projected] : [];
	});
	if (questions.length === 0 || questions.length !== rawQuestions.length) {
		throw new OperationalError('DeepSeek Harness sent an invalid user question request');
	}

	const wait = isRecord(value.request.wait) ? value.request.wait : undefined;
	return {
		eventId: value.eventId,
		toolCallId: (wait && optionalString(wait, 'callId')) ?? value.eventId,
		payload: {
			type: 'harness-question',
			questions,
		},
	};
}

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
	options: { hasStreamedText?: boolean } = {},
): {
	text?: string;
	turnEnded?: boolean;
} {
	if (frame.type === 'event' && frame.event) {
		const event = frame.event;
		if (event.type === 'assistant/message') {
			return options.hasStreamedText ? {} : { text: textFromAssistantEvent(event) };
		}
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
			if (record.event.type === 'assistant/message' && !options.hasStreamedText) {
				text += textFromAssistantEvent(record.event);
			}
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
			reuseSession?: boolean;
			supportsHitl?: boolean;
			resume?: ExecuteAgentResume;
		} = {},
	): Promise<ExecuteAgentData> {
		return await this.executeInternal(agentId, projectId, message, sessionId, options);
	}

	private async executeInternal(
		agentId: string,
		projectId: string,
		message: string,
		sessionId: string,
		options: {
			allowUnpublished?: boolean;
			sendResponseChunk?: StreamResponseChunk;
			workspaceId?: string;
			reuseSession?: boolean;
			supportsHitl?: boolean;
			resume?: ExecuteAgentResume;
		},
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
		const configuration = await this.webService.getConfigurationStatusForRuntime(runtime.url);
		if (!configuration.configured) {
			throw new OperationalError(
				'DeepSeek Harness profile is not configured with a model and Credential',
			);
		}

		const { origin, cookie } = await this.authenticate(runtime.url);
		const actualSessionId =
			options.reuseSession || options.resume
				? sessionId
				: await this.createSession(
						origin,
						cookie,
						sessionId,
						options.workspaceId && options.workspaceId !== 'empty-workspace'
							? options.workspaceId
							: runtime.workspaceId,
					);
		const result = await this.promptAndFollow(
			origin,
			cookie,
			actualSessionId,
			message,
			options.sendResponseChunk,
			{ supportsHitl: options.supportsHitl, resume: options.resume },
		);

		return {
			response: result.response,
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
			...(result.suspension
				? {
						suspension: {
							agentId,
							threadId: actualSessionId,
							suspensions: [result.suspension],
						},
					}
				: {}),
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

	private async call<T>(
		origin: string,
		cookie: string,
		endpoint: string,
		args: object,
	): Promise<T> {
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
			throw new OperationalError(
				body.result?.error.message ?? `DeepSeek Harness ${endpoint} failed`,
			);
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
		options: HarnessFollowOptions = {},
	): Promise<HarnessFollowResult> {
		return await new Promise<HarnessFollowResult>((resolve, reject) => {
			const socket = new WebSocket(`${origin.replace(/^http/u, 'ws')}/api/remote.mux`, {
				headers: { cookie },
			});
			const followStreamId = `n8n-${crypto.randomUUID()}`;
			const eventStreamId = `n8n-${crypto.randomUUID()}`;
			const useRemoteEvents = options.supportsHitl === true || options.resume !== undefined;
			let response = '';
			let settled = false;
			let followReady = false;
			let eventClientId: string | undefined;
			let started = false;
			let resumeAccepted = options.resume === undefined;
			let streamedText = false;
			let hasStreamedText = false;

			const finish = (error?: Error, suspension?: AgentWorkflowSuspension) => {
				if (settled) return;
				settled = true;
				socket.close();
				if (error) reject(error);
				else resolve({ response, ...(suspension ? { suspension } : {}) });
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

			const start = async () => {
				if (started || !followReady) return;
				started = true;
				if (sendResponseChunk) await sendResponseChunk('begin');
				if (!options.resume) sendPrompt();
			};

			socket.once('open', () => {
				socket.send(
					JSON.stringify({
						type: 'open',
						streamId: followStreamId,
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
				if (useRemoteEvents) {
					socket.send(
						JSON.stringify({
							type: 'open',
							streamId: eventStreamId,
							endpoint: '$events',
							payload: { args: {} },
						}),
					);
				}
			});
			socket.on('message', async (raw: Buffer | string) => {
				try {
					const frame = JSON.parse(raw.toString()) as {
						type?: string;
						streamId?: string;
						value?: unknown;
						error?: { message?: string };
					};
					if (frame.type === 'error') {
						finish(new OperationalError(frame.error?.message ?? 'DeepSeek Harness stream failed'));
						return;
					}
					if (frame.type !== 'item' || !frame.value) return;
					if (frame.streamId === eventStreamId) {
						if (
							isRecord(frame.value) &&
							frame.value.type === 'ready' &&
							typeof frame.value.clientId === 'string'
						) {
							eventClientId = frame.value.clientId;
							await start();
							return;
						}

						const question = parseHarnessQuestionRemoteEvent(frame.value);
						if (!question) return;
						if (options.resume && !resumeAccepted) {
							if (
								question.eventId !== options.resume.runId ||
								question.toolCallId !== options.resume.toolCallId ||
								!eventClientId
							) {
								return;
							}
							await this.call(origin, cookie, '$events/result', {
								clientId: eventClientId,
								eventId: question.eventId,
								outcome: { kind: 'result', value: options.resume.resumeData },
							});
							resumeAccepted = true;
							return;
						}

						if (sendResponseChunk) await sendResponseChunk('end');
						finish(undefined, {
							runId: question.eventId,
							toolCallId: question.toolCallId,
							toolName: 'ask_user_question',
							suspendPayload: question.payload,
						});
						return;
					}
					if (frame.streamId !== undefined && frame.streamId !== followStreamId) return;
					if (!isSessionFollowFrame(frame.value)) return;
					const follow = frame.value;
					if (!followReady) {
						if (follow.type !== 'snapshot') return;
						followReady = true;
						await start();
						return;
					}

					const applied = applyFollowFrame(follow, { hasStreamedText });
					if (applied.text) {
						response += applied.text;
						streamedText = true;
						if (follow.type === 'assistant-stream') hasStreamedText = true;
						if (sendResponseChunk) await sendResponseChunk('item', applied.text);
					}
					if (applied.turnEnded && resumeAccepted) {
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
