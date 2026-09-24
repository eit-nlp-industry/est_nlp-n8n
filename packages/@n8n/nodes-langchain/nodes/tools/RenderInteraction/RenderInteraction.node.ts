import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

import {
	buildRenderInteractionPayload,
	type InteractionFormField,
	type InteractionSelectOption,
} from './render-interaction-payload';

const JSON_RENDER_V1_FORMAT = 'json-render-v1';

function parseJsonArray(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSelectOptions(raw: unknown): InteractionSelectOption[] {
	const options: InteractionSelectOption[] = [];
	for (const item of parseJsonArray(raw)) {
		if (!isRecord(item)) continue;
		if (typeof item.value === 'string' && typeof item.label === 'string') {
			options.push({ value: item.value, label: item.label });
		}
	}
	return options;
}

function resolveSelectOptions(field: {
	options?: { option?: InteractionSelectOption[] } | InteractionSelectOption[];
	optionsJson?: unknown;
}): InteractionSelectOption[] {
	const fromJson = asSelectOptions(field.optionsJson);
	if (fromJson.length > 0) return fromJson;
	if (Array.isArray(field.options)) return field.options;
	return field.options?.option ?? [];
}

type DashboardMetric = {
	label: string;
	value: string;
	trend?: 'up' | 'down' | 'neutral';
	trendLabel?: string;
};

type DashboardTable = {
	columns: string[];
	rows: string[][];
};

function readInteractionInput(
	context: IExecuteFunctions,
	itemIndex: number,
): {
	title: string;
	description?: string;
	metrics?: DashboardMetric[];
	table?: DashboardTable;
	fields: InteractionFormField[];
} {
	const title = context.getNodeParameter('title', itemIndex, '') as string;
	const description = context.getNodeParameter('description', itemIndex, '') as string;
	const metrics = context.getNodeParameter('metrics.metrics', itemIndex, []) as DashboardMetric[];
	const tableColumns = context.getNodeParameter('tableColumns', itemIndex, []) as string[];
	const tableRowsRaw = context.getNodeParameter('tableRows', itemIndex, '[]') as
		| string
		| string[][];
	let tableRows: string[][] = [];
	if (Array.isArray(tableRowsRaw)) {
		tableRows = tableRowsRaw;
	} else if (typeof tableRowsRaw === 'string' && tableRowsRaw.trim()) {
		try {
			tableRows = JSON.parse(tableRowsRaw) as string[][];
		} catch {
			tableRows = [];
		}
	}

	const table =
		tableColumns.length > 0
			? {
					columns: tableColumns,
					rows: tableRows,
				}
			: undefined;

	const fieldsRaw = context.getNodeParameter('fields.field', itemIndex, []) as Array<{
		key: string;
		label: string;
		type: InteractionFormField['type'];
		options?: { option?: InteractionSelectOption[] } | InteractionSelectOption[];
		optionsJson?: unknown;
		defaultValue?: string;
		defaultValues?: string;
		placeholder?: string;
	}>;

	const fields: InteractionFormField[] = fieldsRaw.map((field) => {
		const selectOptions = resolveSelectOptions(field);
		switch (field.type) {
			case 'select':
				return {
					key: field.key,
					label: field.label,
					type: 'select',
					options: selectOptions,
					...(field.defaultValue ? { default: field.defaultValue } : {}),
				};
			case 'multipleSelect': {
				let defaultValues: string[] = [];
				if (field.defaultValues?.trim()) {
					try {
						defaultValues = JSON.parse(field.defaultValues) as string[];
					} catch {
						defaultValues = [];
					}
				}
				return {
					key: field.key,
					label: field.label,
					type: 'multipleSelect',
					options: selectOptions,
					...(defaultValues.length > 0 ? { default: defaultValues } : {}),
				};
			}
			case 'inputNumber':
				return {
					key: field.key,
					label: field.label,
					type: 'inputNumber',
					default: Number(field.defaultValue) || 0,
					...(field.placeholder ? { placeholder: field.placeholder } : {}),
				};
			case 'input':
			default:
				return {
					key: field.key,
					label: field.label,
					type: 'input',
					...(field.defaultValue ? { default: field.defaultValue } : {}),
					...(field.placeholder ? { placeholder: field.placeholder } : {}),
				};
		}
	});

	return {
		title,
		...(description ? { description } : {}),
		...(metrics.length > 0 ? { metrics } : {}),
		...(table ? { table } : {}),
		fields,
	};
}

export class RenderInteraction implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Render Interaction',
		name: 'renderInteraction',
		icon: 'fa:hand-pointer',
		iconColor: 'black',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["title"]}}',
		description:
			'Build a json-render interaction payload (dashboard + form fields) for chat decision UIs',
		defaults: {
			name: 'Render Interaction',
		},
		usableAsTool: true,
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools', 'Root Nodes'],
				Tools: ['Other Tools'],
			},
			alias: ['interaction', 'json-render', 'decision', 'form', 'select', 'hitl'],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				description: 'Card title shown above the interaction',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'Optional summary under the title',
			},
			{
				displayName: 'Metrics',
				name: 'metrics',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				options: [
					{
						displayName: 'Metric',
						name: 'metrics',
						values: [
							{
								displayName: 'Label',
								name: 'label',
								type: 'string',
								default: '',
								required: true,
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								required: true,
							},
							{
								displayName: 'Trend',
								name: 'trend',
								type: 'options',
								options: [
									{ name: 'Up', value: 'up' },
									{ name: 'Down', value: 'down' },
									{ name: 'Neutral', value: 'neutral' },
								],
								default: 'neutral',
							},
							{
								displayName: 'Trend Label',
								name: 'trendLabel',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Table Columns',
				name: 'tableColumns',
				type: 'string',
				typeOptions: {
					multipleValues: true,
				},
				default: [],
			},
			{
				displayName: 'Table Rows',
				name: 'tableRows',
				type: 'json',
				default: '[]',
				description: 'Array of string arrays',
			},
			{
				displayName: 'Form Fields',
				name: 'fields',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				options: [
					{
						displayName: 'Field',
						name: 'field',
						values: [
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
								required: true,
							},
							{
								displayName: 'Label',
								name: 'label',
								type: 'string',
								default: '',
								required: true,
							},
							{
								displayName: 'Type',
								name: 'type',
								type: 'options',
								options: [
									{ name: 'Select', value: 'select' },
									{ name: 'Multiple Select', value: 'multipleSelect' },
									{ name: 'Number', value: 'inputNumber' },
									{ name: 'Text', value: 'input' },
								],
								default: 'select',
							},
							{
								displayName: 'Options',
								name: 'options',
								type: 'fixedCollection',
								typeOptions: {
									multipleValues: true,
								},
								default: {},
								displayOptions: {
									show: {
										type: ['select', 'multipleSelect'],
									},
								},
								options: [
									{
										displayName: 'Option',
										name: 'option',
										values: [
											{
												displayName: 'Value',
												name: 'value',
												type: 'string',
												default: '',
												required: true,
											},
											{
												displayName: 'Label',
												name: 'label',
												type: 'string',
												default: '',
												required: true,
											},
										],
									},
								],
							},
							{
								displayName: 'Options JSON',
								name: 'optionsJson',
								type: 'json',
								default: '[]',
								description:
									'Array of {value, label}. Use $fromAI when options come from the current search.',
								displayOptions: {
									show: {
										type: ['select', 'multipleSelect'],
									},
								},
							},
							{
								displayName: 'Default Value',
								name: 'defaultValue',
								type: 'string',
								default: '',
								displayOptions: {
									show: {
										type: ['select', 'input', 'inputNumber'],
									},
								},
							},
							{
								displayName: 'Default Values (JSON Array)',
								name: 'defaultValues',
								type: 'string',
								default: '[]',
								displayOptions: {
									show: {
										type: ['multipleSelect'],
									},
								},
							},
							{
								displayName: 'Placeholder',
								name: 'placeholder',
								type: 'string',
								default: '',
								displayOptions: {
									show: {
										type: ['input', 'inputNumber'],
									},
								},
							},
						],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const input = readInteractionInput(this, itemIndex);
				if (input.fields.length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						'Render Interaction requires at least one form field',
					);
				}

				const built = buildRenderInteractionPayload(input);
				returnData.push({
					json: {
						format: JSON_RENDER_V1_FORMAT,
						payload: built.payload,
						phase: 'decision',
					} as IDataObject,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
