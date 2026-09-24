import { Tool } from '@n8n/agents';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { COLLECT_DECISION_TOOL_ID } from '../tool-ids';
import { buildCollectDecisionPayload } from './collect-decision.payload';
import {
	collectDecisionInputSchema,
	collectDecisionOutputSchema,
	collectDecisionResumeSchema,
	type CollectDecisionInput,
} from './collect-decision.schema';

export { COLLECT_DECISION_TOOL_ID };

const collectDecisionSuspendSchema = z.object({
	requestId: z.string(),
	message: z.string(),
	severity: z.literal('info'),
	inputType: z.literal('json-render'),
	introMessage: z.string().optional(),
	jsonRender: z.record(z.string(), z.unknown()),
});

export function createCollectDecisionTool() {
	return new Tool(COLLECT_DECISION_TOOL_ID)
		.description(
			'Present a rich json-render decision UI and suspend until the user submits structured choices. ' +
				'Use for complex decisions: selecting rows, comparing options, tuning parameters. ' +
				'Does NOT execute side effects — use approval tools for final authorization. ' +
				'Do not use ask-user for multi-field dashboards; do not use render-ui when you need input back.',
		)
		.input(collectDecisionInputSchema)
		.output(collectDecisionOutputSchema)
		.suspend(collectDecisionSuspendSchema)
		.resume(collectDecisionResumeSchema)
		.handler(async (input: CollectDecisionInput, ctx) => {
			const resumeData = ctx.resumeData;

			if (resumeData === undefined || resumeData === null) {
				const jsonRender = buildCollectDecisionPayload(input);
				return await ctx.suspend({
					requestId: nanoid(),
					message: input.introMessage ?? input.title,
					severity: 'info' as const,
					inputType: 'json-render' as const,
					introMessage: input.introMessage,
					jsonRender,
				});
			}

			if (!resumeData.approved || !resumeData.value) {
				return { decided: false };
			}

			return { decided: true, value: resumeData.value };
		})
		.build();
}
