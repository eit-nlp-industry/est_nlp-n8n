import type { FetchFn } from '../model/model-factory';
import type { TokenUsage } from '../../types/sdk/agent';
import type { ModelTurnDebugPayload } from '../../types/runtime/model-turn-debug';

/** One teed model HTTP call with JSON request + final aggregated response. */
export interface RawModelHttpTurn {
	url: string;
	method: string;
	timestamp: number;
	endTime: number;
	status?: number;
	streamed?: boolean;
	/** Parsed request JSON when possible; otherwise the raw text. */
	requestBody?: unknown;
	/** Final completion JSON (SSE aggregated or non-stream parse); not the raw SSE log. */
	responseBody?: unknown;
	error?: string;
}

export interface RawModelHttpIo {
	fetch: FetchFn;
	/** Await in-flight response body tees. Call before drain(). */
	flush(): Promise<void>;
	/** Take completed turns since the last drain (order preserved). */
	drain(): RawModelHttpTurn[];
}

function resolveUrl(input: RequestInfo | URL): string {
	if (typeof input === 'string') return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

/**
 * Capture the request body as raw text. String and byte bodies are kept as-is.
 * Stream / Blob / FormData are not consumed (that would break the live call).
 */
function bodyToRawText(body: BodyInit | null | undefined): string | undefined {
	if (body == null) return undefined;
	if (typeof body === 'string') return body;
	if (body instanceof URLSearchParams) return body.toString();
	if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) {
		return new TextDecoder().decode(body);
	}
	if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
		return new TextDecoder().decode(body);
	}
	return `[non-string request body: ${Object.prototype.toString.call(body)}]`;
}

function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/** Parse a JSON request body when possible; otherwise keep the string. */
export function parseRequestBodyJson(raw: string | undefined): unknown {
	if (raw === undefined) return undefined;
	return tryParseJson(raw) ?? raw;
}

function parseSseDataPayloads(sseText: string): unknown[] {
	const payloads: unknown[] = [];
	for (const line of sseText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data:')) continue;
		const data = trimmed.slice('data:'.length).trim();
		if (data === '' || data === '[DONE]') continue;
		const parsed = tryParseJson(data);
		if (parsed !== undefined) payloads.push(parsed);
	}
	return payloads;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ToolCallAcc {
	id?: string;
	type?: string;
	function?: { name?: string; arguments?: string };
}

function mergeToolCallDelta(acc: ToolCallAcc[], delta: unknown): void {
	if (!isRecord(delta)) return;
	const index = typeof delta.index === 'number' ? delta.index : 0;
	const slot = acc[index] ?? { function: { name: '', arguments: '' } };
	if (typeof delta.id === 'string') slot.id = delta.id;
	if (typeof delta.type === 'string') slot.type = delta.type;
	const fn = delta.function;
	if (isRecord(fn)) {
		slot.function ??= { name: '', arguments: '' };
		if (typeof fn.name === 'string') slot.function.name = `${slot.function.name ?? ''}${fn.name}`;
		if (typeof fn.arguments === 'string') {
			slot.function.arguments = `${slot.function.arguments ?? ''}${fn.arguments}`;
		}
	}
	acc[index] = slot;
}

/**
 * Aggregate OpenAI-compatible `chat.completion.chunk` SSE into one final
 * `chat.completion`-shaped object (content / tool_calls / usage).
 */
export function aggregateOpenAiCompatibleSse(payloads: unknown[]): unknown | undefined {
	const chunks = payloads.filter(isRecord);
	if (chunks.length === 0) return undefined;

	const looksLikeChatChunk = chunks.some(
		(c) => c.object === 'chat.completion.chunk' || Array.isArray(c.choices),
	);
	if (!looksLikeChatChunk) return undefined;

	const first = chunks[0]!;
	const toolCalls: ToolCallAcc[] = [];
	let content = '';
	let reasoningContent = '';
	let role = 'assistant';
	let finishReason: string | null = null;
	let usage: unknown;
	let id = typeof first.id === 'string' ? first.id : undefined;
	let created = typeof first.created === 'number' ? first.created : undefined;
	let model = typeof first.model === 'string' ? first.model : undefined;

	for (const chunk of chunks) {
		if (typeof chunk.id === 'string') id = chunk.id;
		if (typeof chunk.created === 'number') created = chunk.created;
		if (typeof chunk.model === 'string') model = chunk.model;
		if (chunk.usage !== undefined) usage = chunk.usage;

		const choices = chunk.choices;
		if (!Array.isArray(choices) || choices.length === 0) continue;
		const choice = choices[0];
		if (!isRecord(choice)) continue;
		if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;

		const delta = choice.delta;
		if (!isRecord(delta)) continue;
		if (typeof delta.role === 'string') role = delta.role;
		if (typeof delta.content === 'string') content += delta.content;
		if (typeof delta.reasoning_content === 'string') reasoningContent += delta.reasoning_content;
		if (Array.isArray(delta.tool_calls)) {
			for (const toolDelta of delta.tool_calls) mergeToolCallDelta(toolCalls, toolDelta);
		}
	}

	const message: Record<string, unknown> = { role, content: content || null };
	if (reasoningContent) message.reasoning_content = reasoningContent;
	const compactTools = toolCalls.filter((t) => t !== undefined);
	if (compactTools.length > 0) message.tool_calls = compactTools;

	return {
		id,
		object: 'chat.completion',
		created,
		model,
		choices: [
			{
				index: 0,
				message,
				finish_reason: finishReason,
			},
		],
		...(usage !== undefined ? { usage } : {}),
	};
}

/**
 * Aggregate Anthropic Messages SSE into the final message object.
 */
export function aggregateAnthropicSse(payloads: unknown[]): unknown | undefined {
	const events = payloads.filter(isRecord);
	if (events.length === 0) return undefined;
	if (!events.some((e) => typeof e.type === 'string' && e.type.startsWith('message_'))) {
		return undefined;
	}

	let message: Record<string, unknown> | undefined;
	const textByIndex = new Map<number, string>();
	const jsonByIndex = new Map<number, string>();

	for (const event of events) {
		const type = event.type;
		if (type === 'message_start' && isRecord(event.message)) {
			message = { ...event.message };
			continue;
		}
		if (type === 'content_block_start' && isRecord(event.content_block)) {
			const index = typeof event.index === 'number' ? event.index : 0;
			const block = event.content_block;
			if (block.type === 'text' && typeof block.text === 'string') {
				textByIndex.set(index, block.text);
			}
			if (block.type === 'tool_use') {
				jsonByIndex.set(index, '');
			}
			if (message && Array.isArray(message.content)) {
				const content = [...message.content];
				content[index] = block;
				message = { ...message, content };
			}
			continue;
		}
		if (type === 'content_block_delta' && isRecord(event.delta)) {
			const index = typeof event.index === 'number' ? event.index : 0;
			const delta = event.delta;
			if (delta.type === 'text_delta' && typeof delta.text === 'string') {
				textByIndex.set(index, `${textByIndex.get(index) ?? ''}${delta.text}`);
			}
			if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
				jsonByIndex.set(index, `${jsonByIndex.get(index) ?? ''}${delta.partial_json}`);
			}
			continue;
		}
		if (type === 'message_delta' && isRecord(event.delta)) {
			message = {
				...(message ?? {}),
				...(typeof event.delta.stop_reason === 'string'
					? { stop_reason: event.delta.stop_reason }
					: {}),
				...(event.usage !== undefined ? { usage: event.usage } : {}),
			};
		}
	}

	if (!message) return undefined;

	const content = Array.isArray(message.content) ? [...message.content] : [];
	for (const [index, text] of textByIndex) {
		const block = isRecord(content[index]) ? { ...content[index] } : { type: 'text' };
		content[index] = { ...block, type: 'text', text };
	}
	for (const [index, partial] of jsonByIndex) {
		const block = isRecord(content[index]) ? { ...content[index] } : { type: 'tool_use' };
		let input: unknown = partial;
		const parsed = tryParseJson(partial);
		if (parsed !== undefined) input = parsed;
		content[index] = { ...block, input };
	}
	if (content.length > 0) message = { ...message, content };

	return message;
}

/**
 * Turn a response wire body into the final JSON result:
 * - non-SSE JSON → parsed object
 * - OpenAI-compatible SSE → aggregated chat.completion
 * - Anthropic SSE → aggregated message
 * - otherwise keep the original text
 */
export function finalizeResponseBody(rawText: string, streamed: boolean): unknown {
	if (!streamed) {
		return tryParseJson(rawText) ?? rawText;
	}

	const payloads = parseSseDataPayloads(rawText);
	const openAi = aggregateOpenAiCompatibleSse(payloads);
	if (openAi !== undefined) return openAi;
	const anthropic = aggregateAnthropicSse(payloads);
	if (anthropic !== undefined) return anthropic;

	// Single JSON body mislabeled as SSE, or empty stream.
	return tryParseJson(rawText) ?? (payloads.length > 0 ? payloads.at(-1) : rawText);
}

/**
 * Wrap `fetch` so each model HTTP call records parsed request JSON and the
 * final aggregated response JSON (not the raw SSE transcript).
 */
export function createRawModelHttpIo(baseFetch?: FetchFn): RawModelHttpIo {
	const underlying: FetchFn = baseFetch ?? globalThis.fetch.bind(globalThis);
	const turns: RawModelHttpTurn[] = [];
	const pendingReads: Array<Promise<void>> = [];

	const recordingFetch: FetchFn = async (input, init) => {
		const turn: RawModelHttpTurn = {
			url: resolveUrl(input),
			method: (init?.method ?? 'GET').toUpperCase(),
			timestamp: Date.now(),
			endTime: Date.now(),
			requestBody: parseRequestBodyJson(bodyToRawText(init?.body ?? null)),
		};
		turns.push(turn);

		let response: Response;
		try {
			response = await underlying(input, init);
		} catch (error) {
			turn.endTime = Date.now();
			turn.error = error instanceof Error ? error.message : String(error);
			throw error;
		}

		turn.endTime = Date.now();
		turn.status = response.status;
		turn.streamed = (response.headers.get('content-type') ?? '').includes('text/event-stream');

		// Tee off a clone so the AI SDK consumer is unaffected.
		try {
			const teed = response.clone();
			const streamed = turn.streamed === true;
			pendingReads.push(
				teed
					.text()
					.then((text) => {
						turn.responseBody = finalizeResponseBody(text, streamed);
					})
					.catch(() => {
						// Recording must never fail the live call.
					}),
			);
		} catch {
			// Some responses cannot be cloned; keep status/url only.
		}

		return response;
	};

	return {
		fetch: recordingFetch,
		async flush() {
			await Promise.allSettled(pendingReads);
			pendingReads.length = 0;
		},
		drain() {
			return turns.splice(0, turns.length);
		},
	};
}

/** Attach loop metadata to one HTTP turn for the debug event / stream chunk. */
export function buildModelTurnDebugPayload(
	args: {
		turnIndex: number;
		model?: string;
		finishReason?: string;
		usage?: TokenUsage;
		emptyRetries?: number;
	},
	http: RawModelHttpTurn,
): ModelTurnDebugPayload {
	return {
		turnIndex: args.turnIndex,
		timestamp: http.timestamp,
		endTime: http.endTime,
		...(args.model ? { model: args.model } : {}),
		...(args.finishReason ? { finishReason: args.finishReason } : {}),
		...(args.usage
			? {
					usage: {
						promptTokens: args.usage.promptTokens,
						completionTokens: args.usage.completionTokens,
						totalTokens: args.usage.totalTokens,
					},
				}
			: {}),
		...(args.emptyRetries !== undefined && args.emptyRetries > 0
			? { emptyRetries: args.emptyRetries }
			: {}),
		url: http.url,
		method: http.method,
		...(http.status !== undefined ? { status: http.status } : {}),
		...(http.streamed === true ? { streamed: true } : {}),
		...(http.requestBody !== undefined ? { requestBody: http.requestBody } : {}),
		...(http.responseBody !== undefined ? { responseBody: http.responseBody } : {}),
		...(http.error !== undefined ? { error: http.error } : {}),
	};
}
