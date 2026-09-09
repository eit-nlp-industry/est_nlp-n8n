import { JSON_RENDER_V1_FORMAT, type RenderUiInput, type RenderUiOutput } from './render-ui.schema';

interface SpecElement {
	type: string;
	props?: Record<string, unknown>;
	children?: string[];
}

/** Build a display-only json-render-v1 Card + Metric + Table payload. */
export function buildRenderUiDashboardPayload(input: RenderUiInput): RenderUiOutput['payload'] {
	const elements: Record<string, SpecElement> = {};
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

	return {
		format: JSON_RENDER_V1_FORMAT,
		schemaVersion: '1.0',
		meta: {
			extensions: { renderModule: 'element-plus' },
		},
		spec: { root: 'root', elements },
	};
}
