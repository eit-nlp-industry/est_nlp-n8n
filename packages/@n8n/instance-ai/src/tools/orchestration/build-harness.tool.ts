import { Tool } from '@n8n/agents';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import type {
	CredentialSummary,
	DeepSeekHarnessModelCatalog,
	DeepSeekHarnessModelSelection,
	ModelConfig,
	OrchestrationContext,
} from '../../types';
import { ORCHESTRATION_TOOL_IDS } from '../tool-ids';
import { resolveHarnessBuilderTarget, saveHarnessBuilderTarget } from './harness-target-binding';

const inputSchema = z.object({
	message: z
		.string()
		.min(1)
		.describe(
			'User request context. Standard mode does not apply Persona, plugin, or preset changes from this field.',
		),
	profileId: z.string().optional().describe('Existing Harness profile ID to configure.'),
	name: z.string().optional().describe('Name for a new Harness profile.'),
});

const answerSchema = z.object({
	questionId: z.string(),
	selectedOptions: z.array(z.string()),
	customText: z.string().optional(),
});

const resumeSchema = z.object({
	approved: z.boolean(),
	answers: z.array(answerSchema).optional(),
});

const selectionSuspendSchema = z.object({
	requestId: z.string(),
	message: z.string(),
	severity: z.literal('info'),
	inputType: z.literal('questions'),
	questions: z.array(
		z.object({
			id: z.string(),
			question: z.string(),
			type: z.literal('single'),
			options: z.array(z.string()),
		}),
	),
});

type HarnessConfigurationSelection = DeepSeekHarnessModelSelection & { credentialId: string };

function parseModelId(modelId: ModelConfig | undefined): DeepSeekHarnessModelSelection | undefined {
	const id =
		typeof modelId === 'string' ? modelId : modelId && 'id' in modelId ? modelId.id : undefined;
	if (!id) return undefined;
	const separator = id.indexOf('/');
	if (separator < 1 || separator === id.length - 1) return undefined;
	return { provider: id.slice(0, separator), model: id.slice(separator + 1) };
}

function modelOptions(catalog: DeepSeekHarnessModelCatalog): string[] {
	return catalog.groups.flatMap((group) => group.models.map((model) => `${group.id}:${model.id}`));
}

function isCatalogModel(
	catalog: DeepSeekHarnessModelCatalog,
	selection: DeepSeekHarnessModelSelection | undefined,
): selection is DeepSeekHarnessModelSelection {
	return Boolean(
		selection &&
			catalog.groups.some(
				(group) =>
					group.id === selection.provider &&
					group.models.some((model) => model.id === selection.model),
			),
	);
}

function defaultModelSelection(
	context: OrchestrationContext,
	catalog: DeepSeekHarnessModelCatalog,
): DeepSeekHarnessModelSelection | undefined {
	const current = parseModelId(context.modelId);
	if (isCatalogModel(catalog, current)) return current;
	if (isCatalogModel(catalog, catalog.default)) return catalog.default;
	return undefined;
}

function credentialTypeForProvider(provider: string): string | undefined {
	return {
		openai: 'openAiApi',
		anthropic: 'anthropicApi',
		deepseek: 'deepSeekApi',
		'deepseek-official': 'deepSeekApi',
	}[provider.toLowerCase()];
}

function credentialOptions(
	credentials: CredentialSummary[],
	selection: DeepSeekHarnessModelSelection | undefined,
): string[] {
	const credentialType = selection ? credentialTypeForProvider(selection.provider) : undefined;
	return credentials
		.filter((credential) => !credentialType || credential.type === credentialType)
		.map((credential) => `${credential.id}:${credential.name}`);
}

function selectedAnswer(
	answers: Array<z.infer<typeof answerSchema>> | undefined,
	questionId: string,
): string | undefined {
	return answers?.find((answer) => answer.questionId === questionId)?.selectedOptions[0];
}

export function createBuildHarnessTool(context: OrchestrationContext) {
	return new Tool(ORCHESTRATION_TOOL_IDS.BUILD_HARNESS)
		.description(
			'Create or configure a DeepSeek Harness profile. Configure its model and Credential, then verify standard mode. ' +
				'Return the unpublished profile after the standard-mode check. The message is context only and does not ' +
				'configure Persona, plugins, or presets. Do not run Harness Creator.',
		)
		.input(inputSchema)
		.output(
			z.object({
				ok: z.literal(true),
				profileId: z.string(),
				profileName: z.string(),
				provider: z.string(),
				model: z.string(),
				published: z.boolean(),
			}),
		)
		.suspend(selectionSuspendSchema)
		.resume(resumeSchema)
		.handler(async (input, ctx) => {
			const domain = context.domainContext;
			const builder = domain?.harnessBuilderDelegate;
			if (!builder) throw new Error('DeepSeek Harness Builder is not available on this instance.');

			const savedTarget = await resolveHarnessBuilderTarget(domain);
			const resumableTarget =
				savedTarget?.phase === 'completed' ||
				(input.profileId !== undefined && savedTarget?.profileId !== input.profileId)
					? undefined
					: savedTarget;
			const targetId = input.profileId ?? resumableTarget?.profileId;
			const profile = targetId
				? await builder.getProfile(targetId)
				: await builder.createProfile(input.name);
			if (!profile) throw new Error(`DeepSeek Harness profile "${input.profileId}" was not found.`);

			const hasResumeData = ctx.resumeData !== undefined && ctx.resumeData !== null;
			if (!hasResumeData && !resumableTarget) {
				await saveHarnessBuilderTarget(domain, {
					profileId: profile.agentId,
					projectId: domain.projectId ?? '',
					name: profile.name,
				phase: 'selection',
				});
			}

			const catalog = await builder.getModelCatalog(profile.agentId);
			if (!catalog || modelOptions(catalog).length === 0)
				throw new Error('The Harness runtime did not report any selectable models.');

			const isBaselineRetry =
			resumableTarget?.phase === 'baseline' &&
			!!resumableTarget.baselineSessionId &&
			!hasResumeData;
			let selection: HarnessConfigurationSelection | undefined;

			if (!isBaselineRetry && !hasResumeData) {
				const credentials = await builder.listCredentials();
				if (credentials.length === 0) {
					throw new Error('No project Credential is available. Create or grant access to one first.');
				}

				const model = defaultModelSelection(context, catalog);
				const matchingCredentials = credentialOptions(credentials, model);
				if (model && matchingCredentials.length === 1) {
					selection = { ...model, credentialId: matchingCredentials[0].split(':', 1)[0] };
				} else {
					const needsModel = !model || matchingCredentials.length === 0;
					return await ctx.suspend({
						requestId: nanoid(),
						message:
							model && !needsModel
								? 'Select the project Credential to use for the current Assistant model.'
								: 'Select the Harness model and project Credential to use.',
						severity: 'info' as const,
						inputType: 'questions' as const,
						questions: [
							...(needsModel
								? [
										{
											id: 'model',
											question: 'Which provider and model should this Harness use?',
											type: 'single' as const,
											options: modelOptions(catalog),
										},
									]
								: []),
							{
								id: 'credential',
								question: 'Which project Credential should provide the API key?',
								type: 'single' as const,
								options: needsModel
									? credentials.map((item) => `${item.id}:${item.name}`)
									: matchingCredentials,
							},
						],
					});
				}
			} else if (!isBaselineRetry) {
				const resumeData = ctx.resumeData;
				if (!resumeData?.approved || !resumeData.answers) {
					throw new Error('Harness setup was cancelled. The profile remains an unpublished draft.');
				}
				const fallbackModel = defaultModelSelection(context, catalog);
				const selectedModel = selectedAnswer(resumeData.answers, 'model');
				const [provider, model] = (selectedModel ?? '').split(':');
				const resolvedModel = selectedModel
					? { provider, model }
					: fallbackModel;
				if (!isCatalogModel(catalog, resolvedModel))
					throw new Error('The selected Harness model is invalid.');
				const credentials = await builder.listCredentials();
				const credential = selectedAnswer(resumeData.answers, 'credential');
				if (!credential) throw new Error('A Harness Credential is required before configuration can continue.');
				const credentialId = credential.split(':', 1)[0];
				const availableCredentials = credentialOptions(credentials, resolvedModel);
				if (!availableCredentials.some((option) => option.split(':', 1)[0] === credentialId))
					throw new Error('The selected Harness Credential is invalid for this model.');
				selection = { ...resolvedModel, credentialId };
			}

			const provider = selection?.provider ?? resumableTarget?.provider ?? catalog.default?.provider ?? 'unknown';
			const model = selection?.model ?? resumableTarget?.model ?? catalog.default?.model ?? 'unknown';
			const configured = isBaselineRetry
				? profile
				: await builder.configureModel(profile.agentId, { provider, model }, selection?.credentialId ?? '');
			if (!configured) throw new Error(`DeepSeek Harness profile "${profile.agentId}" was not found.`);

			const baselineSessionId = resumableTarget?.baselineSessionId ?? `harness-test-${nanoid()}`;
			await saveHarnessBuilderTarget(domain, {
				profileId: configured.agentId,
				projectId: domain.projectId ?? '',
				name: configured.name,
				phase: 'baseline',
				provider,
				model,
				baselineSessionId,
			});

			const baselineTest = await builder.test(
				configured.agentId,
				'Reply with a short confirmation that standard mode is configured and working.',
				baselineSessionId,
				isBaselineRetry,
			);
			if (!baselineTest.success) {
				throw new Error(
					baselineTest.message ??
						'Standard mode verification failed. The profile remains an unpublished draft.',
				);
			}
			await saveHarnessBuilderTarget(domain, {
				profileId: configured.agentId,
				projectId: domain.projectId ?? '',
				name: configured.name,
				phase: 'completed',
				provider,
				model,
			});

			return {
				ok: true,
				profileId: configured.agentId,
				profileName: configured.name,
				provider,
				model,
				published: configured.published,
			};
		})
		.build();
}
