import { mock } from 'vitest-mock-extended';

import { executeTool } from '../../../__tests__/tool-test-utils';
import type {
	InstanceAiContext,
	InstanceAiDeepSeekHarnessService,
	ModelConfig,
	OrchestrationContext,
} from '../../../types';
import { createBuildHarnessTool } from '../build-harness.tool';

const profile = {
	agentId: 'harness-1',
	name: 'Research Harness',
	published: false,
	createdAt: '2026-09-28T01:00:00.000Z',
	updatedAt: '2026-09-28T01:00:00.000Z',
};

function makeContext(
	service: InstanceAiDeepSeekHarnessService,
	modelId?: ModelConfig,
): OrchestrationContext {
	const domain = mock<InstanceAiContext>({
		projectId: 'project-1',
		...(modelId ? { modelId } : {}),
		credentialService: {
			list: vi.fn().mockResolvedValue([{ id: 'credential-1', name: 'OpenAI', type: 'openAiApi' }]),
		} as never,
	});
	domain.harnessBuilderDelegate = {
		createProfile: async (name) => await service.createProfile(name),
		getProfile: async (profileId) => await service.get(profileId),
		getModelCatalog: async (profileId) => await service.getModelCatalog(profileId),
		listCredentials: async () => await domain.credentialService.list({ projectId: domain.projectId }),
		configureModel: async (profileId, selection, credentialId) =>
			await service.configureModel(profileId, selection, credentialId),
		test: async (profileId, message, sessionId, reuseSession) =>
			await service.test(profileId, message, sessionId, reuseSession),
		publish: async (profileId) => await service.publish(profileId),
	};
	domain.threadMemory = undefined;
	domain.threadId = undefined;
	return mock<OrchestrationContext>({ domainContext: domain });
}

function catalog() {
	return {
		default: { provider: 'openai', model: 'gpt-4.1' },
		groups: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }] }],
		routableProviders: ['openai'],
		failures: [],
	};
}

describe('build-harness tool', () => {
	it('configures and verifies standard mode without starting Creator', async () => {
		const service = mock<InstanceAiDeepSeekHarnessService>({
			createProfile: vi.fn().mockResolvedValue(profile),
			getModelCatalog: vi.fn().mockResolvedValue(catalog()),
			configureModel: vi.fn().mockResolvedValue(profile),
			test: vi.fn().mockResolvedValue({ success: true, sessionId: 'baseline-session-1' }),
		});

		const result = await executeTool(
			createBuildHarnessTool(makeContext(service, 'openai/gpt-4.1')),
			{ message: 'Create a Harness' },
			{ resumeData: undefined, suspend: vi.fn() },
		);

		expect(result).toEqual({
			ok: true,
			profileId: 'harness-1',
			profileName: 'Research Harness',
			provider: 'openai',
			model: 'gpt-4.1',
			published: false,
		});
		expect(service.configureModel).toHaveBeenCalledWith(
			'harness-1',
			{ provider: 'openai', model: 'gpt-4.1' },
			'credential-1',
		);
		expect(service.test).toHaveBeenCalledWith(
			'harness-1',
			'Reply with a short confirmation that standard mode is configured and working.',
			expect.any(String),
			false,
		);
	});

	it('suspends only for ambiguous model or Credential selection', async () => {
		const service = mock<InstanceAiDeepSeekHarnessService>({
			createProfile: vi.fn().mockResolvedValue(profile),
			getModelCatalog: vi.fn().mockResolvedValue({ ...catalog(), default: undefined }),
			configureModel: vi.fn().mockResolvedValue(profile),
			test: vi.fn().mockResolvedValue({ success: true }),
		});
		const suspend = vi.fn().mockResolvedValue({ suspended: true });

		await executeTool(
			createBuildHarnessTool(makeContext(service)),
			{ message: 'Create a Harness' },
			{ resumeData: undefined, suspend },
		);

		expect(suspend).toHaveBeenCalledWith(
			expect.objectContaining({
				questions: expect.arrayContaining([
					expect.objectContaining({ id: 'model', options: ['openai:gpt-4.1'] }),
				]),
			}),
		);
	});

	it('resumes selection and then returns the tested draft', async () => {
		const service = mock<InstanceAiDeepSeekHarnessService>({
			get: vi.fn().mockResolvedValue(profile),
			getModelCatalog: vi.fn().mockResolvedValue(catalog()),
			configureModel: vi.fn().mockResolvedValue(profile),
			test: vi.fn().mockResolvedValue({ success: true, sessionId: 'baseline-session-1' }),
		});

		const result = await executeTool(
			createBuildHarnessTool(makeContext(service)),
			{ message: 'Create a Harness', profileId: 'harness-1' },
			{
				resumeData: {
					approved: true,
					answers: [
						{ questionId: 'model', selectedOptions: ['openai:gpt-4.1'] },
						{ questionId: 'credential', selectedOptions: ['credential-1:OpenAI'] },
					],
				},
				suspend: vi.fn(),
			},
		);

		expect(result).toMatchObject({ ok: true, published: false });
		expect(service.configureModel).toHaveBeenCalledWith(
			'harness-1',
			{ provider: 'openai', model: 'gpt-4.1' },
			'credential-1',
		);
	});

	it('reuses the baseline session after a failed standard-mode test', async () => {
		const service = mock<InstanceAiDeepSeekHarnessService>({
			get: vi.fn().mockResolvedValue(profile),
			getModelCatalog: vi.fn().mockResolvedValue(catalog()),
			configureModel: vi.fn().mockResolvedValue(profile),
			test: vi
				.fn()
				.mockResolvedValueOnce({ success: false, sessionId: 'baseline-session-1', message: 'temporary failure' })
				.mockResolvedValueOnce({ success: true, sessionId: 'baseline-session-1' }),
		});
		const context = makeContext(service, 'openai/gpt-4.1');
		const tool = createBuildHarnessTool(context);

		await expect(
			executeTool(tool, { message: 'Create a Harness', profileId: 'harness-1' }, { resumeData: undefined, suspend: vi.fn() }),
		).rejects.toThrow('temporary failure');
		context.domainContext!.harnessBuilderTarget = {
			profileId: 'harness-1',
			projectId: 'project-1',
			name: profile.name,
			phase: 'baseline',
			provider: 'openai',
			model: 'gpt-4.1',
			baselineSessionId: 'baseline-session-1',
		};

		await executeTool(
			tool,
			{ message: 'Create a Harness', profileId: 'harness-1' },
			{ resumeData: undefined, suspend: vi.fn() },
		);

		expect(service.configureModel).toHaveBeenCalledTimes(1);
		expect(service.test).toHaveBeenNthCalledWith(
			2,
			'harness-1',
			'Reply with a short confirmation that standard mode is configured and working.',
			'baseline-session-1',
			true,
		);
	});

	it('does not reuse a previous profile session for an explicitly selected profile', async () => {
		const service = mock<InstanceAiDeepSeekHarnessService>({
			get: vi.fn().mockResolvedValue({ ...profile, agentId: 'harness-2', name: 'Other Harness' }),
			getModelCatalog: vi.fn().mockResolvedValue(catalog()),
			configureModel: vi.fn().mockResolvedValue({ ...profile, agentId: 'harness-2' }),
			test: vi.fn().mockResolvedValue({ success: true, sessionId: 'new-session' }),
		});
		const context = makeContext(service, 'openai/gpt-4.1');
		context.domainContext!.harnessBuilderTarget = {
			profileId: 'harness-1',
			projectId: 'project-1',
			phase: 'baseline',
			baselineSessionId: 'old-session',
			provider: 'openai',
			model: 'gpt-4.1',
		};

		await executeTool(
			createBuildHarnessTool(context),
			{ message: 'Configure another Harness', profileId: 'harness-2' },
			{ resumeData: undefined, suspend: vi.fn() },
		);

		expect(service.configureModel).toHaveBeenCalledTimes(1);
		expect(service.test).toHaveBeenCalledWith(
			'harness-2',
			'Reply with a short confirmation that standard mode is configured and working.',
			expect.any(String),
			false,
		);
	});

	it('rejects a resumed Credential that was not offered for the selected model', async () => {
		const service = mock<InstanceAiDeepSeekHarnessService>({
			get: vi.fn().mockResolvedValue(profile),
			getModelCatalog: vi.fn().mockResolvedValue(catalog()),
		});

		await expect(
			executeTool(
				createBuildHarnessTool(makeContext(service)),
				{ message: 'Create a Harness', profileId: 'harness-1' },
				{
					resumeData: {
						approved: true,
						answers: [
							{ questionId: 'model', selectedOptions: ['openai:gpt-4.1'] },
							{ questionId: 'credential', selectedOptions: ['credential-2:Other'] },
						],
					},
					suspend: vi.fn(),
				},
			),
		).rejects.toThrow('invalid');
		expect(service.configureModel).not.toHaveBeenCalled();
	});
});
