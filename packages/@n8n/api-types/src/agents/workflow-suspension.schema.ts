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
