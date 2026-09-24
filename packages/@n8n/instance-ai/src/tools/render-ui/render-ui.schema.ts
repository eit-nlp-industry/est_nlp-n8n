import { z } from 'zod';

export const JSON_RENDER_V1_FORMAT = 'json-render-v1' as const;

export const renderUiMetricSchema = z.object({
	label: z.string().min(1).describe('Short metric label, e.g. "Orders"'),
	value: z.string().min(1).describe('Display value, e.g. "128" or "¥86k"'),
	trend: z.enum(['up', 'down', 'neutral']).optional().describe('Optional trend direction'),
	trendLabel: z.string().optional().describe('Optional trend caption, e.g. "+12%"'),
});

export const renderUiTableSchema = z.object({
	columns: z.array(z.string().min(1)).min(1).describe('Column headers'),
	rows: z.array(z.array(z.string())).describe('Row cells as strings, aligned to columns'),
});

export const renderUiInputSchema = z.object({
	title: z.string().min(1).max(120).describe('Card title shown above the dashboard'),
	description: z.string().max(500).optional().describe('Optional muted summary under the title'),
	metrics: z
		.array(renderUiMetricSchema)
		.max(8)
		.optional()
		.describe('KPI metrics rendered in a horizontal row'),
	table: renderUiTableSchema.optional().describe('Tabular rows rendered below the metrics'),
});

export const renderUiOutputSchema = z.object({
	format: z.literal(JSON_RENDER_V1_FORMAT),
	payload: z.object({
		format: z.literal(JSON_RENDER_V1_FORMAT),
		schemaVersion: z.literal('1.0').optional(),
		meta: z
			.object({
				title: z.string().optional(),
				extensions: z.record(z.string(), z.unknown()).optional(),
			})
			.optional(),
		spec: z.object({
			root: z.string().min(1),
			elements: z.record(z.string(), z.unknown()),
		}),
	}),
});

export type RenderUiInput = z.infer<typeof renderUiInputSchema>;
export type RenderUiOutput = z.infer<typeof renderUiOutputSchema>;
