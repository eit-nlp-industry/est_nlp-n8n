import { Tool } from '@n8n/agents';
import { z } from 'zod';

import type { DeepSeekHarnessProfileSummary, InstanceAiContext } from '../types';
import { DOMAIN_TOOL_IDS } from './tool-ids';

const actionSchema = z.enum(['list', 'get', 'publish']);

const inputSchema = z.object({
	action: actionSchema.describe(
		'List profiles, get one profile, or publish one profile for production execution.',
	),
	agentId: z
		.string()
		.optional()
		.describe('DeepSeek Harness profile ID. Required for get and publish.'),
});

const profileSchema = z.object({
	agentId: z.string(),
	name: z.string(),
	published: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const outputSchema = z.object({
	action: actionSchema,
	count: z.number().optional(),
	profiles: z.array(profileSchema).optional(),
	profile: profileSchema.optional(),
});

function requireAgentId(action: 'get' | 'publish', agentId: string | undefined): string {
	if (!agentId) throw new Error(`agentId is required for the ${action} action`);
	return agentId;
}

export function createDeepSeekHarnessTool(context: InstanceAiContext) {
	return new Tool(DOMAIN_TOOL_IDS.DEEPSEEK_HARNESS)
		.description(
			'Manage DeepSeek Harness profiles in the current project. Use this tool only when the ' +
				'user explicitly asks for DeepSeek Harness. The returned `agentId` is the value for the ' +
				'`agentId` parameter of `n8n-nodes-base.deepSeekHarness`. This tool does not create profiles. ' +
				'Use `build-harness` for Harness creation and configuration. Load the ' +
				'`harness-builder` skill before calling this tool.',
		)
		.input(inputSchema)
		.output(outputSchema)
		.handler(async (input) => {
			const service = context.deepSeekHarnessService;
			if (!service) throw new Error('DeepSeek Harness is not available on this instance.');

			if (input.action === 'list') {
				const profiles = await service.list();
				return { action: input.action, count: profiles.length, profiles };
			}

			let profile: DeepSeekHarnessProfileSummary | null;
			if (input.action === 'get') {
				profile = await service.get(requireAgentId(input.action, input.agentId));
			} else {
				profile = await service.publish(requireAgentId(input.action, input.agentId));
			}

			if (!profile) {
				throw new Error(`DeepSeek Harness profile "${input.agentId}" was not found.`);
			}

			return { action: input.action, profile };
		})
		.build();
}
