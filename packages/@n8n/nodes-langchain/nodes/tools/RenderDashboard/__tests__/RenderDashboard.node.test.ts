import { mock } from 'vitest-mock-extended';

import { RenderDashboard } from '../RenderDashboard.node';
import type { IExecuteFunctions, INode } from 'n8n-workflow';

describe('RenderDashboard node', () => {
	it('builds a json-render-v1 payload from node parameters', async () => {
		const node = new RenderDashboard();
		const executeFunctions = mock<IExecuteFunctions>({
			getInputData: () => [{ json: {} }],
			continueOnFail: () => false,
		});

		executeFunctions.getNode.mockReturnValue(mock<INode>({ name: 'Render Dashboard' }));
		executeFunctions.getNodeParameter.mockImplementation((name: string) => {
			switch (name) {
				case 'title':
					return 'Weather snapshot';
				case 'description':
					return 'Demo cities';
				case 'metrics.metrics':
					return [{ label: 'Shanghai', value: '22°C', trend: 'up', trendLabel: '+2°' }];
				case 'tableColumns':
					return ['City', 'Condition'];
				case 'tableRows':
					return '[["Shanghai","Sunny"]]';
				default:
					return undefined;
			}
		});

		const result = await node.execute.call(executeFunctions);

		expect(result[0][0].json.format).toBe('json-render-v1');
		expect(result[0][0].json.payload).toBeDefined();
	});
});
