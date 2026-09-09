import { executeTool } from '../../../__tests__/tool-test-utils';
import { buildRenderUiDashboardPayload } from '../render-ui.payload';
import { createRenderUiTool } from '../render-ui.tool';

describe('render-ui tool', () => {
	it('returns a json-render-v1 Card + Metric + Table payload', async () => {
		const tool = createRenderUiTool();
		const result = await executeTool(tool, {
			title: 'Weather snapshot',
			description: 'Demo cities',
			metrics: [{ label: 'Shanghai', value: '22°C', trend: 'up', trendLabel: '+2°' }],
			table: {
				columns: ['City', 'Condition'],
				rows: [
					['Shanghai', 'Sunny'],
					['Beijing', 'Cloudy'],
				],
			},
		});

		expect(result.format).toBe('json-render-v1');
		expect(result.payload.spec.root).toBe('root');
		expect(result.payload.spec.elements.root).toMatchObject({ type: 'Card' });
		expect(result.payload.spec.elements['metric-0']).toMatchObject({ type: 'Metric' });
		expect(result.payload.spec.elements.table).toMatchObject({ type: 'Table' });
	});

	it('builds a dashboard payload without a description', () => {
		const payload = buildRenderUiDashboardPayload({
			title: 'Orders',
			metrics: [{ label: 'Total', value: '10' }],
		});
		expect(payload.spec.elements.description).toBeUndefined();
		expect(payload.spec.elements.metrics?.children).toEqual(['metric-0']);
	});
});
