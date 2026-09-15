import { describe, expect, it } from 'vitest';
import { TOOL_CALL_STATE } from '../agentsChat/constants';
import type { ToolCall } from '../agentsChat/types';
import {
	collectJsonRenderCards,
	extractJsonRenderPayload,
	isJsonRenderToolName,
} from '../jsonRender.utils';

const dashboardPayload = {
	format: 'json-render-v1' as const,
	spec: {
		root: 'root',
		elements: {
			root: { type: 'Card', props: { title: 'Weather snapshot' }, children: ['metric'] },
			metric: { type: 'Metric', props: { label: 'Shanghai', value: '22°C' } },
		},
	},
};

const nodeWrapper = {
	format: 'json-render-v1',
	payload: dashboardPayload,
};

describe('extractJsonRenderPayload', () => {
	it('parses the inner payload', () => {
		expect(extractJsonRenderPayload(dashboardPayload)?.spec.root).toBe('root');
	});

	it('unwraps the Render Dashboard { format, payload } wrapper', () => {
		expect(extractJsonRenderPayload(nodeWrapper)?.spec.elements.root).toMatchObject({
			type: 'Card',
		});
	});

	it('unwraps agent node-tool output { status, data: [{ json }] }', () => {
		const result = extractJsonRenderPayload({
			status: 'success',
			data: [{ json: nodeWrapper }],
		});
		expect(result?.spec.elements.metric).toMatchObject({ type: 'Metric' });
	});

	it('unwraps a stringified n8n item array', () => {
		const result = extractJsonRenderPayload(JSON.stringify([nodeWrapper]));
		expect(result?.format).toBe('json-render-v1');
	});

	it('unwraps a chat envelope', () => {
		const result = extractJsonRenderPayload({
			type: 'json-render',
			payload: dashboardPayload,
		});
		expect(result?.spec.root).toBe('root');
	});

	it('unwraps MCP text content', () => {
		const result = extractJsonRenderPayload({
			content: [{ type: 'text', text: JSON.stringify(nodeWrapper) }],
		});
		expect(result?.spec.root).toBe('root');
	});

	it('returns null for unrelated JSON', () => {
		expect(extractJsonRenderPayload({ ok: true })).toBeNull();
		expect(extractJsonRenderPayload('hello')).toBeNull();
	});
});

describe('isJsonRenderToolName', () => {
	it.each(['Render_Dashboard', 'renderDashboard', 'render-ui', 'render_ui'])(
		'matches %s',
		(name) => {
			expect(isJsonRenderToolName(name)).toBe(true);
		},
	);

	it('rejects unrelated tools', () => {
		expect(isJsonRenderToolName('return_and_rest')).toBe(false);
	});
});

describe('collectJsonRenderCards', () => {
	it('builds a card from a completed Render Dashboard tool', () => {
		const toolCall = {
			tool: 'Render_Dashboard',
			toolCallId: 'tc-1',
			state: TOOL_CALL_STATE.DONE,
			input: { title: 'Weather snapshot' },
			output: { status: 'success', data: [{ json: nodeWrapper }] },
		} satisfies ToolCall;

		expect(collectJsonRenderCards([toolCall])).toEqual([
			{
				toolCallId: 'tc-1',
				isLoading: false,
				result: toolCall.output,
				args: { title: 'Weather snapshot' },
			},
		]);
	});

	it('shows a loading card for a named dashboard tool that is still running', () => {
		const cards = collectJsonRenderCards([
			{
				tool: 'render-ui',
				toolCallId: 'tc-loading',
				state: TOOL_CALL_STATE.RUNNING,
			},
		]);

		expect(cards).toEqual([{ toolCallId: 'tc-loading', isLoading: true }]);
	});

	it('falls back to assistant text when no tool produced a dashboard', () => {
		const cards = collectJsonRenderCards([], JSON.stringify(dashboardPayload));
		expect(cards).toHaveLength(1);
		expect(cards[0]?.toolCallId).toBe('assistant-json-render');
	});

	it('ignores unrelated tools', () => {
		expect(
			collectJsonRenderCards([
				{
					tool: 'return_and_rest',
					toolCallId: 'tc-rest',
					state: TOOL_CALL_STATE.DONE,
					output: { ok: true },
				},
			]),
		).toEqual([]);
	});
});
