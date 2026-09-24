import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

import { buildRenderDashboardPayload } from './render-dashboard-payload';

const JSON_RENDER_V1_FORMAT = 'json-render-v1';

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

function readDashboardInput(
	context: IExecuteFunctions,
	itemIndex: number,
): {
	title: string;
	description?: string;
	metrics?: DashboardMetric[];
	table?: DashboardTable;
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

	return {
		title,
		...(description ? { description } : {}),
		...(metrics.length > 0 ? { metrics } : {}),
		...(table ? { table } : {}),
	};
}

export class RenderDashboard implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Render Dashboard',
		name: 'renderDashboard',
		icon: 'fa:table',
		iconColor: 'black',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["title"]}}',
		description:
			'Build a json-render dashboard payload (cards, KPI metrics, and tables) for chat UIs',
		defaults: {
			name: 'Render Dashboard',
		},
		usableAsTool: true,
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools', 'Root Nodes'],
				Tools: ['Other Tools'],
			},
			alias: ['dashboard', 'json-render', 'metrics', 'kpi', 'table'],
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
				description: 'Card title shown above the dashboard',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'Optional muted summary under the title',
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
				description: 'Array of string arrays, e.g. [["Shanghai","Sunny"]]',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const input = readDashboardInput(this, itemIndex);
				if ((input.metrics?.length ?? 0) === 0 && input.table === undefined) {
					throw new NodeOperationError(
						this.getNode(),
						'Render Dashboard requires at least one metric or a table',
					);
				}

				const payload = buildRenderDashboardPayload(input);
				returnData.push({
					json: {
						format: JSON_RENDER_V1_FORMAT,
						payload,
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
