import { z } from 'zod';

import { richMessageSchema } from './rich-card.schema';

const agentWorkflowInteractionBaseSchema = z
	.object({
		runId: z.string().min(1),
		toolCallId: z.string().min(1),
		blockUserInput: z.literal(true),
	})
	.strict();

export const agentWorkflowApprovalPayloadSchema = z
	.object({
		type: z.literal('approval'),
		toolName: z.string().min(1),
		displayName: z.string().min(1).optional(),
		args: z.unknown(),
	})
	.strict();

export const agentWorkflowChatActionPayloadSchema = richMessageSchema.refine(
	(message) => message.card !== undefined,
	{ message: 'Provide a response card for a chat action interaction.' },
);

export const agentWorkflowJsonRenderPayloadSchema = z
	.object({
		type: z.literal('json-render-interaction'),
		jsonRender: z.record(z.string(), z.unknown()),
		message: z.string().optional(),
	})
	.strict();

export const harnessQuestionSchema = z
	.object({
		id: z.string().min(1),
		question: z.string().min(1),
		detail: z.string().optional(),
		header: z.string().optional(),
		options: z
			.array(
				z
					.object({
						label: z.string().min(1),
						description: z.string().optional(),
					})
					.strict(),
			)
			.optional(),
		multiSelect: z.boolean().optional(),
	})
	.strict();

export const harnessQuestionInteractionPayloadSchema = z
	.object({
		type: z.literal('harness-question'),
		questions: z.array(harnessQuestionSchema).min(1),
	})
	.strict();

export type HarnessQuestion = z.infer<typeof harnessQuestionSchema>;
export type HarnessQuestionInteractionPayload = z.infer<
	typeof harnessQuestionInteractionPayloadSchema
>;

export const agentWorkflowInteractionSchema = z.discriminatedUnion('interactionType', [
	agentWorkflowInteractionBaseSchema.extend({
		interactionType: z.literal('approval'),
		payload: agentWorkflowApprovalPayloadSchema,
	}),
	agentWorkflowInteractionBaseSchema.extend({
		interactionType: z.literal('chat_action'),
		payload: agentWorkflowChatActionPayloadSchema,
	}),
	agentWorkflowInteractionBaseSchema.extend({
		interactionType: z.literal('json_render'),
		payload: agentWorkflowJsonRenderPayloadSchema,
	}),
	agentWorkflowInteractionBaseSchema.extend({
		interactionType: z.literal('harness_question'),
		payload: harnessQuestionInteractionPayloadSchema,
	}),
]);

export type AgentWorkflowInteraction = z.infer<typeof agentWorkflowInteractionSchema>;

export const agentWorkflowResumeMessageSchema = z
	.object({
		type: z.literal('agent-suspension-response'),
		runId: z.string().min(1),
		toolCallId: z.string().min(1),
		resumeData: z.unknown(),
	})
	.strict();

export type AgentWorkflowResumeMessage = z.infer<typeof agentWorkflowResumeMessageSchema>;
