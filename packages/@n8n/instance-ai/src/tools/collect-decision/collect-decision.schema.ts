import { z } from 'zod';

import { JSON_RENDER_V1_FORMAT, renderUiMetricSchema, renderUiTableSchema } from '../render-ui/render-ui.schema';

export { JSON_RENDER_V1_FORMAT };

export const collectDecisionFieldSchema = z.discriminatedUnion('type', [
	z.object({
		key: z.string().min(1),
		label: z.string().min(1),
		type: z.literal('select'),
		options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
		default: z.string().optional(),
	}),
	z.object({
		key: z.string().min(1),
		label: z.string().min(1),
		type: z.literal('multipleSelect'),
		options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
		default: z.array(z.string()).optional(),
	}),
	z.object({
		key: z.string().min(1),
		label: z.string().min(1),
		type: z.literal('inputNumber'),
		default: z.number().optional(),
		placeholder: z.string().optional(),
	}),
	z.object({
		key: z.string().min(1),
		label: z.string().min(1),
		type: z.literal('input'),
		default: z.string().optional(),
		placeholder: z.string().optional(),
	}),
]);

export const collectDecisionInputSchema = z.object({
	title: z.string().min(1).max(120),
	description: z.string().max(500).optional(),
	introMessage: z.string().max(500).optional(),
	metrics: z.array(renderUiMetricSchema).max(8).optional(),
	table: renderUiTableSchema.optional(),
	fields: z.array(collectDecisionFieldSchema).min(1).max(12),
});

export const collectDecisionResumeSchema = z.object({
	approved: z.boolean(),
	value: z.record(z.string(), z.unknown()).optional(),
});

export const collectDecisionOutputSchema = z.object({
	decided: z.boolean(),
	value: z.record(z.string(), z.unknown()).optional(),
});

export type CollectDecisionInput = z.infer<typeof collectDecisionInputSchema>;
export type CollectDecisionResumeData = z.infer<typeof collectDecisionResumeSchema>;
