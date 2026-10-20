import type { FetchFn } from '../../model/model-factory';
import {
	aggregateOpenAiCompatibleSse,
	buildModelTurnDebugPayload,
	createRawModelHttpIo,
	finalizeResponseBody,
} from '../model-turn-debug';

describe('finalizeResponseBody', () => {
	it('parses a non-stream JSON body', () => {
		expect(finalizeResponseBody('{"id":"1","choices":[]}', false)).toEqual({
			id: '1',
			choices: [],
		});
	});

	it('aggregates OpenAI-compatible SSE into one chat.completion', () => {
		const sse = [
			'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"role":"assistant","content":"你"},"finish_reason":null}]}',
			'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}',
			'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-pro","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
			'data: [DONE]',
			'',
		].join('\n');

		expect(finalizeResponseBody(sse, true)).toEqual({
			id: 'chatcmpl-1',
			object: 'chat.completion',
			created: 1,
			model: 'deepseek-v4-pro',
			choices: [
				{
					index: 0,
					message: { role: 'assistant', content: '你好' },
					finish_reason: 'stop',
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
		});
	});

	it('aggregates streamed tool_calls', () => {
		const payloads = [
			{
				object: 'chat.completion.chunk',
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: 'call_1',
									type: 'function',
									function: { name: 'search', arguments: '' },
								},
							],
						},
					},
				],
			},
			{
				object: 'chat.completion.chunk',
				choices: [
					{
						delta: { tool_calls: [{ index: 0, function: { arguments: '{"q"' } }] },
						finish_reason: null,
					},
				],
			},
			{
				object: 'chat.completion.chunk',
				choices: [
					{
						delta: { tool_calls: [{ index: 0, function: { arguments: ':"x"}' } }] },
						finish_reason: 'tool_calls',
					},
				],
			},
		];

		expect(aggregateOpenAiCompatibleSse(payloads)).toMatchObject({
			choices: [
				{
					finish_reason: 'tool_calls',
					message: {
						tool_calls: [
							{
								id: 'call_1',
								type: 'function',
								function: { name: 'search', arguments: '{"q":"x"}' },
							},
						],
					},
				},
			],
		});
	});
});

describe('createRawModelHttpIo', () => {
	it('stores parsed request JSON and aggregated final response', async () => {
		const sse = [
			'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}',
			'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
			'data: [DONE]',
			'',
		].join('\n');
		const baseFetch: FetchFn = vi.fn().mockResolvedValue(
			new Response(sse, {
				status: 200,
				headers: { 'content-type': 'text/event-stream' },
			}),
		);
		const io = createRawModelHttpIo(baseFetch);

		const response = await io.fetch('https://api.example.com/v1/chat', {
			method: 'POST',
			body: '{"messages":[{"role":"user","content":"hi"}]}',
		});
		expect(await response.text()).toBe(sse);

		await io.flush();
		const [turn] = io.drain();
		expect(turn.requestBody).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
		expect(turn.responseBody).toEqual({
			id: '1',
			object: 'chat.completion',
			created: 1,
			model: 'm',
			choices: [
				{
					index: 0,
					message: { role: 'assistant', content: 'hi' },
					finish_reason: 'stop',
				},
			],
		});
		expect(typeof turn.responseBody).toBe('object');
	});

	it('records fetch errors without swallowing them', async () => {
		const baseFetch: FetchFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
		const io = createRawModelHttpIo(baseFetch);

		await expect(io.fetch('https://api.example.com/v1/chat')).rejects.toThrow('ECONNRESET');
		await io.flush();
		const [turn] = io.drain();
		expect(turn.error).toBe('ECONNRESET');
		expect(turn.responseBody).toBeUndefined();
	});

	it('leaves the live response readable after tee', async () => {
		const sse =
			'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
		const baseFetch: FetchFn = vi
			.fn()
			.mockResolvedValue(
				new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
			);
		const io = createRawModelHttpIo(baseFetch);

		const response = await io.fetch('https://api.example.com/v1/chat');
		expect(await response.text()).toBe(sse);
		await io.flush();
		expect(io.drain()[0].responseBody).toMatchObject({
			object: 'chat.completion',
			choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
		});
	});
});

describe('buildModelTurnDebugPayload', () => {
	it('attaches loop metadata to a structured HTTP turn', () => {
		const payload = buildModelTurnDebugPayload(
			{
				turnIndex: 2,
				model: 'openai/gpt-4o',
				finishReason: 'stop',
				usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
				emptyRetries: 1,
			},
			{
				url: 'https://api.openai.com/v1/chat/completions',
				method: 'POST',
				timestamp: 100,
				endTime: 250,
				status: 200,
				streamed: true,
				requestBody: { stream: true },
				responseBody: { object: 'chat.completion', choices: [] },
			},
		);

		expect(payload).toEqual({
			turnIndex: 2,
			timestamp: 100,
			endTime: 250,
			model: 'openai/gpt-4o',
			finishReason: 'stop',
			usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
			emptyRetries: 1,
			url: 'https://api.openai.com/v1/chat/completions',
			method: 'POST',
			status: 200,
			streamed: true,
			requestBody: { stream: true },
			responseBody: { object: 'chat.completion', choices: [] },
		});
	});
});
