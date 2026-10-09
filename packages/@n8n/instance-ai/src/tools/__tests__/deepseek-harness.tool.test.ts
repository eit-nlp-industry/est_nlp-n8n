import { mock } from 'vitest-mock-extended';

import { executeTool } from '../../__tests__/tool-test-utils';
import type { InstanceAiContext, InstanceAiDeepSeekHarnessService } from '../../types';
import { createDeepSeekHarnessTool } from '../deepseek-harness.tool';

const profile = {
	agentId: 'harness-1',
	name: 'DeepSeek Harness',
	published: false,
	createdAt: '2026-09-28T01:00:00.000Z',
	updatedAt: '2026-09-28T01:00:00.000Z',
};

function makeContext(service: InstanceAiDeepSeekHarnessService): InstanceAiContext {
	const context = mock<InstanceAiContext>();
	context.deepSeekHarnessService = service;
	return context;
}

describe('deepseek-harness tool', () => {
	it('lists profiles in the current project', async () => {
		const service = mock<InstanceAiDeepSeekHarnessService>({
			list: vi.fn().mockResolvedValue([profile]),
		});

		const result = await executeTool(createDeepSeekHarnessTool(makeContext(service)), {
			action: 'list',
		});

		expect(result).toEqual({ action: 'list', count: 1, profiles: [profile] });
	});

	it('gets one profile', async () => {
		const service = mock<InstanceAiDeepSeekHarnessService>({
			get: vi.fn().mockResolvedValue(profile),
		});

		const result = await executeTool(createDeepSeekHarnessTool(makeContext(service)), {
			action: 'get',
			agentId: 'harness-1',
		});

		expect(result).toEqual({ action: 'get', profile });
		expect(service.get).toHaveBeenCalledWith('harness-1');
	});

	it('publishes a profile for production workflow execution', async () => {
		const publishedProfile = { ...profile, published: true };
		const service = mock<InstanceAiDeepSeekHarnessService>({
			publish: vi.fn().mockResolvedValue(publishedProfile),
		});

		const result = await executeTool(createDeepSeekHarnessTool(makeContext(service)), {
			action: 'publish',
			agentId: 'harness-1',
		});

		expect(result).toEqual({ action: 'publish', profile: publishedProfile });
		expect(service.publish).toHaveBeenCalledWith('harness-1');
	});

	it('requires an agent ID for get and publish', async () => {
		const service = mock<InstanceAiDeepSeekHarnessService>();
		const tool = createDeepSeekHarnessTool(makeContext(service));

		await expect(executeTool(tool, { action: 'get' })).rejects.toThrow(
			'agentId is required for the get action',
		);
		await expect(executeTool(tool, { action: 'publish' })).rejects.toThrow(
			'agentId is required for the publish action',
		);
	});
});
