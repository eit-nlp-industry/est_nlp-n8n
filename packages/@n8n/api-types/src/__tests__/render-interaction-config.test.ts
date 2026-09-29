import { jsonParse, type INodeParameters } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	buildRenderInteractionEditorText,
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
});
