import { jsonParse, type INodeParameters } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	buildRenderInteractionEditorText,
	buildRenderInteractionTemplateText,
	nodeParametersToRenderInteractionConfig,
	parseRenderInteractionConfigText,
	renderInteractionConfigToNodeParameters,
} from '../render-interaction-config.schema';

const sampleNodeParameters: INodeParameters = {
	title: 'Failed executions',
	description: 'Review the failures below.',
	metrics: {
		metrics: [{ label: 'Failed (24h)', value: '12', trend: 'down', trendLabel: '-3' }],
	},
	tableColumns: ['ID', 'Workflow'],
	tableRows: '[["ex-101","Orders"]]',
	fields: {
		field: [
			{
				key: 'action',
				label: 'Action',
				type: 'select',
				options: {
					option: [
						{ value: 'go', label: '前往选中地点' },
						{ value: 'rest', label: '休息' },
					],
				},
				optionsJson: '[]',
				defaultValue: 'go',
			},
			{
				key: 'maxRetries',
				label: 'Max retries',
				type: 'inputNumber',
				defaultValue: '2',
				placeholder: '',
			},
		],
	},
};

describe('render-interaction-config', () => {
	it('builds a valid template with every supported parameter group and field type', () => {
		const parsed = parseRenderInteractionConfigText(buildRenderInteractionTemplateText());

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.config.steps).toMatchObject({
			active: 1,
			direction: 'horizontal',
			alignCenter: false,
			simple: false,
			processStatus: 'process',
			finishStatus: 'finish',
			items: [
				{ title: 'Prepare', description: 'Prepare the request', status: 'finish' },
				{ title: 'Confirm', description: 'Confirm the next action', status: null },
			],
		});
		expect(parsed.config.metrics).toEqual([
			{ label: 'Candidates', value: '10', trend: 'up', trendLabel: '+2' },
		]);
		expect(parsed.config.tableColumns).toEqual(['Name', 'Status']);
		expect(parsed.config.tableRows).toEqual([['Candidate A', 'Ready']]);
		expect(parsed.config.fields.map((field) => field.type)).toEqual([
			'select',
			'multipleSelect',
			'inputNumber',
			'input',
		]);
		expect(
			nodeParametersToRenderInteractionConfig(
				renderInteractionConfigToNodeParameters(parsed.config),
			),
		).toEqual(parsed.config);
	});

	it('exports all Render Interaction parameters and model descriptions', () => {
		const parameters: INodeParameters = {
			title:
				"={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('Title', '交互表单标题', 'string') }}",
			description: 'Build a destination chooser.',
			metrics: { metrics: [] },
			tableColumns: [],
			tableRows: '[]',
			fields: {
				field: [
					{
						key: 'destination',
						label: '去哪个地点',
						type: 'select',
						options: { option: [] },
						optionsJson:
							"={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('field1_Options_JSON', '传原生 JSON 数组，不要 JSON.stringify', 'json') }}",
						defaultValue:
							"={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('field1_Default_Value', '必须是 Options JSON 中某一项的 value', 'string') }}",
					},
				],
			},
		};

		expect(nodeParametersToRenderInteractionConfig(parameters)).toEqual({
			title: {
				$fromAI: { key: 'Title', description: '交互表单标题', type: 'string' },
			},
			description: 'Build a destination chooser.',
			steps: null,
			metrics: [],
			tableColumns: [],
			tableRows: [],
			fields: [
				{
					key: 'destination',
					label: '去哪个地点',
					type: 'select',
					options: [],
					optionsJson: {
						$fromAI: {
							key: 'field1_Options_JSON',
							description: '传原生 JSON 数组，不要 JSON.stringify',
							type: 'json',
						},
					},
					defaultValue: {
						$fromAI: {
							key: 'field1_Default_Value',
							description: '必须是 Options JSON 中某一项的 value',
							type: 'string',
						},
					},
				},
			],
		});
	});

	it('round-trips model-backed Options JSON and AI descriptions', () => {
		const text = JSON.stringify({
			title: {
				$fromAI: { key: 'Title', description: 'Choose a title', type: 'string' },
			},
			description: '',
			metrics: [],
			tableColumns: [],
			tableRows: [],
			fields: [
				{
					key: 'destination',
					label: 'Destination',
					type: 'select',
					options: [],
					optionsJson: {
						$fromAI: {
							key: 'field1_Options_JSON',
							description: 'Return [{"value":"lab","label":"Lab"}]',
							type: 'json',
						},
					},
					defaultValue: '',
				},
			],
		});

		const parsed = parseRenderInteractionConfigText(text);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			const nodeParameters = renderInteractionConfigToNodeParameters(parsed.config);
			expect(nodeParametersToRenderInteractionConfig(nodeParameters)).toEqual(parsed.config);
		}
	});

	it('keeps manual Options JSON separate from fixed options', () => {
		const parameters: INodeParameters = {
			title: 'Choose destination',
			description: '',
			metrics: { metrics: [] },
			tableColumns: [],
			tableRows: '[]',
			fields: {
				field: [
					{
						key: 'destination',
						label: 'Destination',
						type: 'select',
						options: { option: [] },
						optionsJson: '[{"value":"lab","label":"Lab"}]',
						defaultValue: 'lab',
					},
				],
			},
		};

		const config = nodeParametersToRenderInteractionConfig(parameters);
		expect(config?.fields[0]).toEqual({
			key: 'destination',
			label: 'Destination',
			type: 'select',
			options: [],
			optionsJson: [{ value: 'lab', label: 'Lab' }],
			defaultValue: 'lab',
		});

		const roundTrip = renderInteractionConfigToNodeParameters(config!);
		expect(roundTrip.fields).toEqual({
			field: [
				{
					key: 'destination',
					label: 'Destination',
					type: 'select',
					options: { option: [] },
					optionsJson: '[{"value":"lab","label":"Lab"}]',
					defaultValue: 'lab',
				},
			],
		});
	});

	it('round-trips node parameters through the canonical JSON config', () => {
		const config = nodeParametersToRenderInteractionConfig(sampleNodeParameters);
		expect(config).not.toBeNull();
		expect(config?.fields).toHaveLength(2);

		const roundTrip = renderInteractionConfigToNodeParameters(config!, sampleNodeParameters);
		expect(roundTrip.title).toBe('Failed executions');
		expect(roundTrip.fields).toEqual({
			field: [
				{
					key: 'action',
					label: 'Action',
					type: 'select',
					options: {
						option: [
							{ value: 'go', label: '前往选中地点' },
							{ value: 'rest', label: '休息' },
						],
					},
					optionsJson: '[]',
					defaultValue: 'go',
				},
				{
					key: 'maxRetries',
					label: 'Max retries',
					type: 'inputNumber',
					defaultValue: '2',
					placeholder: '',
				},
			],
		});
	});

	it('rejects invalid config JSON', () => {
		const result = parseRenderInteractionConfigText('{"title":"","fields":[]}');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('title');
		}
	});

	it('accepts pasted canonical JSON and maps it to node parameters', () => {
		const json = JSON.stringify(
			{
				title: 'Choose destination',
				fields: [
					{
						key: 'destination',
						label: 'Destination',
						type: 'select',
						options: [{ value: 'lab', label: '110实验室' }],
					},
				],
			},
			null,
			2,
		);

		const parsed = parseRenderInteractionConfigText(json);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			const params = renderInteractionConfigToNodeParameters(parsed.config);
			expect(params.title).toBe('Choose destination');
			expect(params.fields).toEqual({
				field: [
					{
						key: 'destination',
						label: 'Destination',
						type: 'select',
						options: { option: [{ value: 'lab', label: '110实验室' }] },
						optionsJson: '[]',
						defaultValue: '',
					},
				],
			});
		}
	});

	it('includes incomplete fields in the best-effort editor JSON', () => {
		const parameters: INodeParameters = {
			title: 'Choose destination',
			fields: {
				field: [
					{
						key: 'next_action',
						label: 'Next action',
						type: 'select',
						options: {
							option: [{ value: 'go', label: 'Go' }],
						},
					},
					{
						key: 'destination',
						label: 'Destination',
						type: 'select',
						options: { option: [] },
					},
				],
			},
		};

		const editorConfig = jsonParse<{ fields: unknown[] }>(
			buildRenderInteractionEditorText(parameters),
		);

		expect(editorConfig.fields).toEqual([
			{
				key: 'next_action',
				label: 'Next action',
				type: 'select',
				options: [{ value: 'go', label: 'Go' }],
				optionsJson: [],
				defaultValue: '',
			},
			{
				key: 'destination',
				label: 'Destination',
				type: 'select',
				options: [],
				optionsJson: [],
				defaultValue: '',
			},
		]);
	});

	it('rejects the strict config when any form field is incomplete', () => {
		const parameters: INodeParameters = {
			title: 'Choose destination',
			fields: {
				field: [
					{
						key: 'next_action',
						label: 'Next action',
						type: 'select',
						options: {
							option: [{ value: 'go', label: 'Go' }],
						},
					},
					{
						key: 'destination',
						label: 'Destination',
						type: 'select',
						options: { option: [] },
					},
				],
			},
		};

		expect(nodeParametersToRenderInteractionConfig(parameters)).toBeNull();
	});

	it('exports null Steps for an existing configuration without Steps', () => {
		const config = nodeParametersToRenderInteractionConfig(sampleNodeParameters);

		expect(config).toMatchObject({
			title: 'Failed executions',
			description: 'Review the failures below.',
			steps: null,
			tableColumns: ['ID', 'Workflow'],
		});
		expect(config?.fields).toHaveLength(2);
	});

	it('exports every Steps parameter and incomplete item in best-effort JSON', () => {
		const parameters: INodeParameters = {
			title: 'Deployment progress',
			steps: {
				active: 1,
				direction: 'vertical',
				alignCenter: true,
				simpleStyle: true,
				processStatus: 'success',
				finishStatus: 'finish',
				items: {
					items: [
						{ title: 'Build', description: 'Create artifacts', status: 'success' },
						{ title: '', description: '', status: '' },
					],
				},
			},
			fields: { field: [] },
		};

		const editorConfig = jsonParse<{ steps: unknown }>(
			buildRenderInteractionEditorText(parameters),
		);

		expect(editorConfig.steps).toEqual({
			active: 1,
			direction: 'vertical',
			alignCenter: true,
			simple: true,
			processStatus: 'success',
			finishStatus: 'finish',
			items: [
				{ title: 'Build', description: 'Create artifacts', status: 'success' },
				{ title: '', description: '', status: null },
			],
		});
	});

	it('keeps old JSON without Steps valid and normalizes it to null', () => {
		const parsed = parseRenderInteractionConfigText(
			JSON.stringify({
				title: 'Choose destination',
				fields: [{ key: 'destination', label: 'Destination', type: 'input' }],
			}),
		);

		expect(parsed).toMatchObject({ ok: true, config: { steps: null } });
	});

	it.each([
		{ name: 'first step', active: 0 },
		{ name: 'all complete', active: 2 },
	])('accepts a valid Steps active value at $name', ({ active }) => {
		const parsed = parseRenderInteractionConfigText(
			JSON.stringify({
				title: 'Deployment approval',
				steps: {
					active,
					items: [{ title: 'Build' }, { title: 'Approve' }],
				},
				fields: [{ key: 'decision', label: 'Decision', type: 'input' }],
			}),
		);

		expect(parsed.ok).toBe(true);
	});

	it.each([
		{
			name: 'negative active',
			steps: { active: -1, items: [{ title: 'Build' }, { title: 'Approve' }] },
		},
		{
			name: 'active above item count',
			steps: { active: 3, items: [{ title: 'Build' }, { title: 'Approve' }] },
		},
		{ name: 'one item', steps: { active: 0, items: [{ title: 'Build' }] } },
		{ name: 'empty title', steps: { active: 0, items: [{ title: '' }, { title: 'Approve' }] } },
		{
			name: 'whitespace title',
			steps: { active: 0, items: [{ title: '   ' }, { title: 'Approve' }] },
		},
	])('rejects Steps with $name', ({ steps }) => {
		const parsed = parseRenderInteractionConfigText(
			JSON.stringify({
				title: 'Deployment approval',
				steps,
				fields: [{ key: 'decision', label: 'Decision', type: 'input' }],
			}),
		);

		expect(parsed.ok).toBe(false);
	});

	it('accepts duplicate step titles because the protocol does not require unique titles', () => {
		const parsed = parseRenderInteractionConfigText(
			JSON.stringify({
				title: 'Deployment approval',
				steps: { active: 1, items: [{ title: 'Review' }, { title: 'Review' }] },
				fields: [{ key: 'decision', label: 'Decision', type: 'input' }],
			}),
		);

		expect(parsed.ok).toBe(true);
	});

	it('round-trips model-backed Steps values and descriptions', () => {
		const parameters: INodeParameters = {
			title: 'Deployment approval',
			steps: {
				active:
					"={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('Active_step', 'Zero-based active step', 'number') }}",
				items: {
					items: [
						{
							title:
								"={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('Step_1_title', 'First step title', 'string') }}",
							description:
								"={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('Step_1_description', 'First step detail', 'string', 'Ready') }}",
						},
						{ title: 'Approve', description: '' },
					],
				},
			},
			fields: { field: [{ key: 'decision', label: 'Decision', type: 'input' }] },
		};

		const config = nodeParametersToRenderInteractionConfig(parameters);
		expect(config?.steps).toMatchObject({
			active: {
				$fromAI: { key: 'Active_step', description: 'Zero-based active step', type: 'number' },
			},
			items: [
				{
					title: {
						$fromAI: { key: 'Step_1_title', description: 'First step title', type: 'string' },
					},
					description: {
						$fromAI: {
							key: 'Step_1_description',
							description: 'First step detail',
							type: 'string',
							defaultValue: 'Ready',
						},
					},
					status: null,
				},
				{ title: 'Approve', description: '', status: null },
			],
		});
		expect(config).not.toBeNull();
		if (!config) return;
		const roundTrip = renderInteractionConfigToNodeParameters(config);
		expect(nodeParametersToRenderInteractionConfig(roundTrip)).toEqual(config);
	});
});
