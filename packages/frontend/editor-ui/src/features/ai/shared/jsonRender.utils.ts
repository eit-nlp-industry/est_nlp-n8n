import { isRecord } from '@n8n/utils/is-record';
// Vite aliases this to the sibling eit-json-render checkout (see vite/aliases.mts).
// eslint-disable-next-line import-x/no-extraneous-dependencies
import { tryParseJsonRenderPayload, type JsonRenderPayload } from '@eit/json-render-protocol';

import { TOOL_CALL_STATE } from './agentsChat/constants';
import type { ToolCall } from './agentsChat/types';

const MAX_UNWRAP_DEPTH = 8;

export type JsonRenderCardToolCall = {
	toolCallId: string;
	isLoading?: boolean;
	error?: string;
	result?: unknown;
	args?: Record<string, unknown>;
};

/**
 * Pull a json-render payload out of the wrappers agents, node-tools, MCP, and
 * chat envelopes actually return. `tryParseJsonRenderPayload` expects the inner
 * `{ format, spec }` document, not `{ format, payload }` or `{ json, … }`.
 */
export function extractJsonRenderPayload(result: unknown): JsonRenderPayload | null {
	return unwrapJsonRenderPayload(result, 0);
}

export function isJsonRenderToolName(toolName: string): boolean {
	return /render[_-]?dashboard|render[_-]?ui/i.test(toolName);
}

export function collectJsonRenderCards(
	toolCalls: ToolCall[],
	assistantText?: string,
): JsonRenderCardToolCall[] {
	const cards: JsonRenderCardToolCall[] = [];

	for (const toolCall of toolCalls) {
		const payload = extractJsonRenderPayload(toolCall.output);
		const named = isJsonRenderToolName(toolCall.tool);
		const loading =
			toolCall.state === TOOL_CALL_STATE.PENDING || toolCall.state === TOOL_CALL_STATE.RUNNING;

		if (!payload && !(named && loading)) continue;

		const card: JsonRenderCardToolCall = {
			toolCallId: toolCall.toolCallId,
			isLoading: Boolean(named && loading && !payload),
		};
		if (toolCall.state === TOOL_CALL_STATE.ERROR && named && typeof toolCall.output === 'string') {
			card.error = toolCall.output;
		}
		if (toolCall.output !== undefined) card.result = toolCall.output;
		if (isRecord(toolCall.input)) card.args = toolCall.input;
		cards.push(card);
	}

	if (cards.length > 0) return cards;

	const trimmed = assistantText?.trim();
	if (!trimmed) return [];
	if (extractJsonRenderPayload(trimmed) === null) return [];

	return [{ toolCallId: 'assistant-json-render', result: trimmed }];
}

function unwrapJsonRenderPayload(value: unknown, depth: number): JsonRenderPayload | null {
	if (depth > MAX_UNWRAP_DEPTH || value == null) return null;

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const direct = tryParseJsonRenderPayload(trimmed);
		if (direct) return direct;
		try {
			return unwrapJsonRenderPayload(JSON.parse(trimmed) as unknown, depth + 1);
		} catch {
			return null;
		}
	}

	const parsed = tryParseJsonRenderPayload(value);
	if (parsed) return parsed;

	if (Array.isArray(value)) {
		for (const item of value) {
			const found = unwrapJsonRenderPayload(item, depth + 1);
			if (found) return found;
		}
		return null;
	}

	if (!isRecord(value)) return null;

	if (value.type === 'json-render') {
		const found = unwrapJsonRenderPayload(value.payload, depth + 1);
		if (found) return found;
	}

	if (value.payload !== undefined) {
		const found = unwrapJsonRenderPayload(value.payload, depth + 1);
		if (found) return found;
	}

	if (value.json !== undefined) {
		const found = unwrapJsonRenderPayload(value.json, depth + 1);
		if (found) return found;
	}

	if (Array.isArray(value.data)) {
		const found = unwrapJsonRenderPayload(value.data, depth + 1);
		if (found) return found;
	}

	if (value.response !== undefined) {
		const found = unwrapJsonRenderPayload(value.response, depth + 1);
		if (found) return found;
	}

	if (Array.isArray(value.content)) {
		for (const item of value.content) {
			if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') continue;
			const found = unwrapJsonRenderPayload(item.text, depth + 1);
			if (found) return found;
		}
	}

	return null;
}
