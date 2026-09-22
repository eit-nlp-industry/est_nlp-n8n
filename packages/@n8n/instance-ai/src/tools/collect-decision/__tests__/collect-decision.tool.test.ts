import { vi } from 'vitest';

import { buildCollectDecisionPayload } from '../collect-decision.payload';
import { createCollectDecisionTool } from '../collect-decision.tool';

describe('collect-decision tool', () => {
	it('builds a payload with canonical form fields', () => {
		const payload = buildCollectDecisionPayload({
			title: 'Retry failed executions',
			fields: [
				{
					key: 'executionIds',
					label: 'Executions',
					type: 'multipleSelect',
					options: [
						{ value: 'ex-1', label: 'ex-1' },
						{ value: 'ex-2', label: 'ex-2' },
					],
					default: ['ex-1'],
				},
			],
		});

		expect(payload.meta).not.toHaveProperty('dynamicForm');
		expect(Object.values(payload.spec.elements)).toContainEqual(
			expect.objectContaining({ type: 'DynamicForm', props: { fields: expect.any(Array) } }),
		);
		expect(payload.spec.root).toBe('root');
	});

	it('suspends on first call', async () => {
		const tool = createCollectDecisionTool();
		const suspend = vi.fn(async () => {
			throw new Error('suspended');
		});
		const handler = tool.handler;
		expect(handler).toBeDefined();
		if (!handler) throw new Error('collect-decision handler is missing');

		await expect(
			handler(
				{
					title: 'Pick route',
					fields: [
						{
							key: 'routeId',
							label: 'Route',
							type: 'select',
							options: [
								{ value: 'a', label: 'Route A' },
								{ value: 'b', label: 'Route B' },
							],
						},
					],
				},
				{ resumeData: undefined, suspend },
			),
		).rejects.toThrow('suspended');

		expect(suspend).toHaveBeenCalledWith(
			expect.objectContaining({
				inputType: 'json-render',
				jsonRender: expect.objectContaining({ format: 'json-render-v1' }),
			}),
		);
	});
});
