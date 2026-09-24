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

export type RenderDashboardInput = {
	title: string;
	description?: string;
	metrics?: DashboardMetric[];
	table?: DashboardTable;
};

interface SpecElement {
	type: string;
	props?: Record<string, unknown>;
	children?: string[];
}

export function buildRenderDashboardPayload(input: RenderDashboardInput) {
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
