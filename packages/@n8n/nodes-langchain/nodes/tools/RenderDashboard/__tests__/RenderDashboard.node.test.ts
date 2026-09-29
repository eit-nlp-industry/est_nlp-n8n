import { mock } from 'vitest-mock-extended';

import { RenderDashboard } from '../RenderDashboard.node';
import type { IExecuteFunctions, INode, NodeParameterValueType } from 'n8n-workflow';

describe('RenderDashboard node', () => {
	function createExecuteFunctions(parameters: Record<string, unknown>) {
		const executeFunctions = mock<IExecuteFunctions>({
			getInputData: () => [{ json: {} }],
			continueOnFail: () => false,
		});

		executeFunctions.getNode.mockReturnValue(mock<INode>({ name: 'Render Dashboard' }));
		executeFunctions.getNodeParameter.mockImplementation((name, _itemIndex, fallback) => {
			return (parameters[name] ?? fallback) as object | NodeParameterValueType;
		});
		return executeFunctions;
	}

	it('builds a Steps-only dashboard through the protocol builder', async () => {
		const node = new RenderDashboard();
		const executeFunctions = createExecuteFunctions({
			title: 'Delivery progress',
			steps: {
				active: 1,
				direction: 'horizontal',
				items: {
					items: [
						{ title: 'Packed', description: 'Ready to leave', status: 'finish' },
						{ title: 'Shipped', status: 'process' },
					],
				},
			},
		});

		const result = await node.execute.call(executeFunctions);
		const payload = result[0][0].json.payload as {
			spec: { elements: Record<string, { type: string; children?: string[] }> };
		};

		expect(result[0][0].json.format).toBe('json-render-v1');
		expect(payload.spec.elements.steps).toMatchObject({
			type: 'Steps',
			children: ['step-0', 'step-1'],
		});
		expect(payload.spec.elements.body?.children).toEqual(['steps']);
	});

	it('builds mixed Steps, metrics, and table content', async () => {
		const node = new RenderDashboard();
		const executeFunctions = createExecuteFunctions({
			title: 'Weather snapshot',
			description: 'Demo cities',
			steps: {
				active: 2,
				items: { items: [{ title: 'Collect' }, { title: 'Render' }] },
			},
			'metrics.metrics': [{ label: 'Shanghai', value: '22°C', trend: 'up', trendLabel: '+2°' }],
			tableColumns: ['City', 'Condition'],
			tableRows: '[["Shanghai","Sunny"]]',
		});

		const result = await node.execute.call(executeFunctions);
		const payload = result[0][0].json.payload as {
			spec: { elements: Record<string, { children?: string[] }> };
		};

		expect(payload.spec.elements.body?.children).toEqual([
			'description',
			'steps',
			'metrics',
			'table',
		]);
	});

	it('rejects a dashboard without Steps, metrics, or table', async () => {
		const node = new RenderDashboard();
		const executeFunctions = createExecuteFunctions({ title: 'Empty' });

		await expect(node.execute.call(executeFunctions)).rejects.toThrow(
			/at least one Steps group, metric, or table/,
		);
	});
});
