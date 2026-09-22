import { appendDynamicFormToSpec, type JsonRenderSpec } from '@eit/json-render-protocol';

import type { CollectDecisionInput } from './collect-decision.schema';

function toProtocolFormField(field: CollectDecisionInput['fields'][number]) {
	switch (field.type) {
		case 'select':
			return {
				key: field.key,
				label: field.label,
				type: 'select' as const,
				value: {
					options: field.options,
					default: field.default ?? field.options[0]?.value ?? '',
				},
			};
		case 'multipleSelect':
			return {
				key: field.key,
				label: field.label,
				type: 'multipleSelect' as const,
				value: {
					options: field.options,
					default: field.default ?? [],
					multiple: true,
				},
			};
		case 'inputNumber':
			return {
				key: field.key,
				label: field.label,
				type: 'inputNumber' as const,
				value: field.default ?? 0,
				...(field.placeholder ? { placeholder: field.placeholder } : {}),
			};
		case 'input':
			return {
				key: field.key,
				label: field.label,
				type: 'input' as const,
				value: field.default ?? '',
				...(field.placeholder ? { placeholder: field.placeholder } : {}),
			};
	}
}

export function buildCollectDecisionPayload(input: CollectDecisionInput) {
	const elements: JsonRenderSpec['elements'] = {};
	const bodyChildren: string[] = [];

	if (input.description) {
		elements.description = {
			type: 'Text',
			props: { content: input.description, variant: 'muted' },
		};
		bodyChildren.push('description');
	}

	if (input.metrics?.length) {
		const metricIds: string[] = [];
		for (const [index, metric] of input.metrics.entries()) {
			const id = `metric-${index}`;
			elements[id] = {
				type: 'Metric',
				props: {
					label: metric.label,
					value: metric.value,
					...(metric.trend ? { trend: metric.trend } : {}),
					...(metric.trendLabel ? { trendLabel: metric.trendLabel } : {}),
				},
			};
			metricIds.push(id);
		}
		elements.metrics = {
			type: 'Stack',
			props: { direction: 'horizontal', gap: 'md', align: 'stretch' },
			children: metricIds,
		};
		bodyChildren.push('metrics');
	}

	if (input.table) {
		elements.table = {
			type: 'Table',
			props: {
				columns: input.table.columns,
				rows: input.table.rows,
			},
		};
		bodyChildren.push('table');
	}

	if (bodyChildren.length > 0) {
		elements.body = {
			type: 'Stack',
			props: { direction: 'vertical', gap: 'md', align: 'stretch' },
			children: bodyChildren,
		};
		elements.root = {
			type: 'Card',
			props: { title: input.title, variant: 'outlined' },
			children: ['body'],
		};
	} else {
		elements.root = {
			type: 'Card',
			props: { title: input.title, variant: 'outlined' },
		};
	}

	const protocolFields = input.fields.map(toProtocolFormField);

	return {
		format: 'json-render-v1' as const,
		schemaVersion: '1.0' as const,
		meta: {
			title: input.title,
			...(input.description ? { description: input.description } : {}),
			extensions: { renderModule: 'element-plus', phase: 'decision' },
		},
		spec: appendDynamicFormToSpec({ root: 'root', elements }, protocolFields),
		state: {
			initial: {
				form: Object.fromEntries(
					protocolFields.map((field) => {
						if (field.type === 'select') {
							const value = field.value as { default?: string };
							return [field.key, value.default ?? ''];
						}
						if (field.type === 'multipleSelect') {
							const value = field.value as { default?: string[] };
							return [field.key, value.default ?? []];
						}
						return [field.key, field.value ?? ''];
					}),
				),
			},
		},
	};
}
