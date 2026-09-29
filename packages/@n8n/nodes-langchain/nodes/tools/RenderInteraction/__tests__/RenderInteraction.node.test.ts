import type { IExecuteFunctions, INode, NodeParameterValueType } from 'n8n-workflow';
import { mock } from 'vitest-mock-extended';

import { RenderInteraction } from '../RenderInteraction.node';

describe('RenderInteraction node', () => {
	function createExecuteFunctions(parameters: Record<string, unknown>) {
		const executeFunctions = mock<IExecuteFunctions>({
			getInputData: () => [{ json: {} }],
			continueOnFail: () => false,
		});

		executeFunctions.getNode.mockReturnValue(mock<INode>({ name: 'Render Interaction' }));
		executeFunctions.getNodeParameter.mockImplementation((name, _itemIndex, fallback) => {
			return (parameters[name] ?? fallback) as object | NodeParameterValueType;
		});
		return executeFunctions;
	}

	it('renders Steps before the canonical form', async () => {
		const node = new RenderInteraction();
		const executeFunctions = createExecuteFunctions({
			title: 'Deployment approval',
			steps: {
				active: 1,
				items: { items: [{ title: 'Build' }, { title: 'Approve' }] },
			},
			'fields.field': [{ key: 'decision', label: 'Decision', type: 'input' }],
		});

		const result = await node.execute.call(executeFunctions);
		const payload = result[0][0].json.payload as {
			spec: { root: string; elements: Record<string, { type: string; children?: string[] }> };
		};
		const rootChildren = payload.spec.elements[payload.spec.root]?.children ?? [];
		const formKey = rootChildren.find((key) => payload.spec.elements[key]?.type === 'DynamicForm');

		expect(payload.spec.elements.steps).toMatchObject({ type: 'Steps' });
		expect(payload.spec.elements.body?.children).toContain('steps');
		expect(rootChildren.indexOf('body')).toBeLessThan(rootChildren.indexOf(formKey ?? ''));
	});

	it('keeps the decision wrapper and form actions unchanged with Steps', async () => {
		const node = new RenderInteraction();
		const executeFunctions = createExecuteFunctions({
			title: 'Deployment approval',
			steps: {
				active: 2,
				items: { items: [{ title: 'Build' }, { title: 'Approve' }] },
			},
			'fields.field': [
				{ key: 'decision', label: 'Decision', type: 'input', defaultValue: 'approve' },
			],
		});

		const result = await node.execute.call(executeFunctions);
		const output = result[0][0].json;
		const payload = output.payload as {
			spec: {
				elements: Record<
					string,
					{ type: string; props?: Record<string, unknown>; on?: Record<string, { action: string }> }
				>;
			};
			state: { initial: { form: Record<string, unknown> } };
		};
		const actions = Object.values(payload.spec.elements).flatMap((element) =>
			Object.values(element.on ?? {}).map((binding) => binding.action),
		);

		expect(output).toMatchObject({ format: 'json-render-v1', phase: 'decision' });
		expect(
			Object.values(payload.spec.elements).filter((element) => element.type === 'DynamicForm'),
		).toHaveLength(1);
		expect(actions).toEqual(expect.arrayContaining(['form.submit', 'form.cancel']));
		expect(payload.state.initial.form).toEqual({ decision: 'approve' });
	});

	it('still rejects an interaction without form fields', async () => {
		const node = new RenderInteraction();
		const executeFunctions = createExecuteFunctions({
			title: 'Progress only',
			steps: {
				active: 1,
				items: { items: [{ title: 'Build' }, { title: 'Approve' }] },
			},
		});

		await expect(node.execute.call(executeFunctions)).rejects.toThrow(
			'Render Interaction requires at least one form field',
		);
	});

	it('builds a json-render interaction payload with form fields', async () => {
		const node = new RenderInteraction();
		const executeFunctions = mock<IExecuteFunctions>();
		executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
		executeFunctions.getNodeParameter.mockImplementation((name: string) => {
			if (name === 'title') return 'Failed executions';
			if (name === 'description') return 'Select records to retry';
			if (name === 'metrics.metrics') return [];
			if (name === 'tableColumns') return ['ID', 'Workflow', 'Error'];
			if (name === 'tableRows') return '[["ex-1","Orders","Timeout"],["ex-2","Sync","Auth"]]';
			if (name === 'fields.field') {
				return [
					{
						key: 'executionIds',
						label: 'Executions',
						type: 'multipleSelect',
						options: [
							{ value: 'ex-1', label: 'ex-1 — Orders' },
							{ value: 'ex-2', label: 'ex-2 — Sync' },
						],
						defaultValues: '["ex-1"]',
					},
					{
						key: 'maxRetries',
						label: 'Max retries',
						type: 'inputNumber',
						defaultValue: '2',
					},
				];
			}
			return undefined;
		});

		const result = await node.execute.call(executeFunctions);

		expect(result[0][0].json.format).toBe('json-render-v1');
		expect(result[0][0].json.phase).toBe('decision');
		const payload = result[0][0].json.payload as {
			meta?: Record<string, unknown>;
			spec: { elements: Record<string, { type: string; props?: Record<string, unknown> }> };
		};
		expect(payload.meta).not.toHaveProperty('dynamicForm');
		expect(Object.values(payload.spec.elements)).toContainEqual(
			expect.objectContaining({ type: 'DynamicForm', props: { fields: expect.any(Array) } }),
		);
	});

	it('prefers Options JSON when the model fills select choices at runtime', async () => {
		const node = new RenderInteraction();
		const executeFunctions = mock<IExecuteFunctions>();
		executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
		executeFunctions.getNodeParameter.mockImplementation((name: string) => {
			if (name === 'title') return 'Choose destination';
			if (name === 'description') return '';
			if (name === 'metrics.metrics') return [];
			if (name === 'tableColumns') return [];
			if (name === 'tableRows') return '[]';
			if (name === 'fields.field') {
				return [
					{
						key: 'destination',
						label: '去哪个地点',
						type: 'select',
						optionsJson:
							'[{"value":"110实验室","label":"110实验室"},{"value":"203教室","label":"203教室"}]',
					},
				];
			}
			return undefined;
		});

		const result = await node.execute.call(executeFunctions);
		const payload = result[0][0].json.payload as {
			spec: { elements: Record<string, { type: string; props?: Record<string, unknown> }> };
		};
		const form = Object.values(payload.spec.elements).find(
			(element) => element.type === 'DynamicForm',
		);
		const fields = form?.props?.fields as Array<{
			key: string;
			value?: { options?: unknown[] };
		}>;
		expect(fields[0]?.key).toBe('destination');
		expect(fields[0]?.value?.options).toEqual([
			{ value: '110实验室', label: '110实验室' },
			{ value: '203教室', label: '203教室' },
		]);
	});
});
