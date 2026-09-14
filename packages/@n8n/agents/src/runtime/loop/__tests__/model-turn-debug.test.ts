import { describe, expect, it } from 'vitest';

import { buildModelTurnDebugPayload, MODEL_TURN_DEBUG_MAX_BYTES } from '../model-turn-debug';

describe('buildModelTurnDebugPayload', () => {
	it('captures request and response snapshots', () => {
		const payload = buildModelTurnDebugPayload({
			turnIndex: 0,
			timestamp: 1000,
			endTime: 1500,
			model: 'test-model',
			finishReason: 'stop',
			usage: {
				promptTokens: 10,
				completionTokens: 5,
				totalTokens: 15,
			},
			system: { role: 'system', content: 'sys' },
			messages: [{ role: 'user', content: 'hi' }],
			aiTools: { search: {} as never },
			responseMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'hello' }] }],
		});

		expect(payload.turnIndex).toBe(0);
		expect(payload.request.toolNames).toEqual(['search']);
		expect(payload.request.messages).toEqual([{ role: 'user', content: 'hi' }]);
		expect(payload.response.messages).toHaveLength(1);
		expect(payload.truncated).toBeUndefined();
		expect(payload.emptyRetries).toBeUndefined();
	});

	it('records emptyRetries when greater than zero', () => {
		const payload = buildModelTurnDebugPayload({
			turnIndex: 0,
			timestamp: 1,
			endTime: 2,
			emptyRetries: 2,
			system: { role: 'system', content: 'sys' },
			messages: [],
			responseMessages: [],
		});

		expect(payload.emptyRetries).toBe(2);
	});

	it('omits file/image binary payloads instead of expanding them', () => {
		const bytes = new Uint8Array(64 * 1024).fill(7);
		const payload = buildModelTurnDebugPayload({
			turnIndex: 0,
			timestamp: 1,
			endTime: 2,
			system: { role: 'system', content: 'sys' },
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'see image' },
						{ type: 'file', mediaType: 'image/png', data: bytes },
					],
				},
			],
			responseMessages: [
				{
					role: 'assistant',
					content: [{ type: 'file', mediaType: 'application/pdf', data: 'base64-pdf-payload' }],
				},
			],
		});

		expect(payload.truncated).toBeUndefined();
		expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThanOrEqual(
			MODEL_TURN_DEBUG_MAX_BYTES,
		);
		expect(JSON.stringify(payload)).not.toContain('"7"');
		expect(payload.request.messages).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'see image' },
					{ type: 'file', omitted: true, mediaType: 'image/png' },
				],
			},
		]);
		expect(payload.response.messages).toEqual([
			{
				role: 'assistant',
				content: [{ type: 'file', omitted: true, mediaType: 'application/pdf' }],
			},
		]);
	});

	it('hard-caps oversized text snapshots within the byte budget', () => {
		const huge = 'x'.repeat(MODEL_TURN_DEBUG_MAX_BYTES);
		const payload = buildModelTurnDebugPayload({
			turnIndex: 1,
			timestamp: 1,
			endTime: 2,
			system: { role: 'system', content: huge },
			messages: [{ role: 'user', content: huge }],
			responseMessages: [{ role: 'assistant', content: [{ type: 'text', text: huge }] }],
		});

		expect(payload.truncated).toBe(true);
		expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThanOrEqual(
			MODEL_TURN_DEBUG_MAX_BYTES,
		);
	});

	it('falls back to an empty stub when many short fields still exceed the budget', () => {
		const many = Array.from({ length: 4_000 }, (_, i) => ({
			role: 'user' as const,
			content: `msg-${i}-${'y'.repeat(80)}`,
		}));
		const payload = buildModelTurnDebugPayload({
			turnIndex: 2,
			timestamp: 1,
			endTime: 2,
			system: { role: 'system', content: 'sys' },
			messages: many,
			aiTools: { search: {} as never },
			responseMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }],
		});

		expect(payload.truncated).toBe(true);
		expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThanOrEqual(
			MODEL_TURN_DEBUG_MAX_BYTES,
		);
		expect(payload.request.messages).toEqual([]);
		expect(payload.request.toolNames).toEqual(['search']);
	});
});
