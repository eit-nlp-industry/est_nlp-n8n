import type { JsonRenderStepStatus, JsonRenderStepsInput } from '@eit/json-render-protocol';
import type { IExecuteFunctions, INodeProperties } from 'n8n-workflow';

const STEP_STATUS_OPTIONS = [
	{ name: 'Automatic', value: '' },
	{ name: 'Wait', value: 'wait' },
	{ name: 'Process', value: 'process' },
	{ name: 'Finish', value: 'finish' },
	{ name: 'Error', value: 'error' },
	{ name: 'Success', value: 'success' },
];

export const renderStepsParameter: INodeProperties = {
	displayName: 'Steps',
	name: 'steps',
	type: 'collection',
	placeholder: 'Add Steps',
	default: {},
	options: [
		{
			displayName: 'Active Step',
			name: 'active',
			type: 'number',
			default: 0,
			typeOptions: { minValue: 0, numberStepSize: 1 },
			description: 'Zero-based active step. Use the item count when all steps are complete.',
		},
		{
			displayName: 'Direction',
			name: 'direction',
			type: 'options',
			options: [
				{ name: 'Horizontal', value: 'horizontal' },
				{ name: 'Vertical', value: 'vertical' },
			],
			default: 'horizontal',
		},
		{
			displayName: 'Align Center',
			name: 'alignCenter',
			type: 'boolean',
			default: false,
		},
		{
			displayName: 'Simple',
			name: 'simpleStyle',
			type: 'boolean',
			default: false,
		},
		{
			displayName: 'Process Status',
			name: 'processStatus',
			type: 'options',
			options: STEP_STATUS_OPTIONS.slice(1),
			default: 'process',
		},
		{
			displayName: 'Finish Status',
			name: 'finishStatus',
			type: 'options',
			options: STEP_STATUS_OPTIONS.slice(1),
			default: 'finish',
		},
		{
			displayName: 'Items',
			name: 'items',
			type: 'fixedCollection',
			typeOptions: { multipleValues: true },
			placeholder: 'Add Step',
			default: {},
			options: [
				{
					displayName: 'Step',
					name: 'items',
					values: [
						{
							displayName: 'Title',
							name: 'title',
							type: 'string',
							default: '',
							required: true,
						},
						{
							displayName: 'Description',
							name: 'description',
							type: 'string',
							default: '',
						},
						{
							displayName: 'Status',
							name: 'status',
							type: 'options',
							options: STEP_STATUS_OPTIONS,
							default: '',
						},
					],
				},
			],
		},
	],
};

export function readRenderStepsInput(
	context: IExecuteFunctions,
	itemIndex: number,
): JsonRenderStepsInput | undefined {
	const raw: unknown = context.getNodeParameter('steps', itemIndex, {});
	if (!isRecord(raw)) return undefined;
	const itemsCollection = raw.items;
	if (!isRecord(itemsCollection) || !Array.isArray(itemsCollection.items)) return undefined;
	if (itemsCollection.items.length === 0) return undefined;

	return {
		active: typeof raw.active === 'number' ? raw.active : 0,
		items: itemsCollection.items.map((item) => {
			const value = isRecord(item) ? item : {};
			return {
				title: typeof value.title === 'string' ? value.title : '',
				...(typeof value.description === 'string' && value.description
					? { description: value.description }
					: {}),
				...(isStepStatus(value.status) ? { status: value.status } : {}),
			};
		}),
		...(raw.direction === 'vertical' || raw.direction === 'horizontal'
			? { direction: raw.direction }
			: {}),
		...(typeof raw.alignCenter === 'boolean' ? { alignCenter: raw.alignCenter } : {}),
		...(typeof raw.simpleStyle === 'boolean' ? { simple: raw.simpleStyle } : {}),
		...(isStepStatus(raw.processStatus) ? { processStatus: raw.processStatus } : {}),
		...(isStepStatus(raw.finishStatus) ? { finishStatus: raw.finishStatus } : {}),
	};
}

function isStepStatus(value: unknown): value is JsonRenderStepStatus {
	return (
		value === 'wait' ||
		value === 'process' ||
		value === 'finish' ||
		value === 'error' ||
		value === 'success'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
