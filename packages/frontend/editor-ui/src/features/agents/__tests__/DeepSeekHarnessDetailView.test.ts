import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { vi } from 'vitest';

import DeepSeekHarnessDetailView from '../views/DeepSeekHarnessDetailView.vue';

const getAgent = vi.fn().mockResolvedValue({ id: 'agent-1', name: 'Agent' });
const startStudio = vi
	.fn()
	.mockResolvedValue({ url: '/deepseek-harness-studio/project-1/agent-1/?token=x' });
const restartStudio = vi
	.fn()
	.mockResolvedValue({ url: '/deepseek-harness-studio/project-1/agent-1/?token=y' });
const updateAgent = vi.fn().mockResolvedValue({ id: 'agent-1', name: 'Renamed' });

vi.mock('vue-router', () => ({
	useRoute: () => ({
		params: { projectId: 'project-1', agentId: 'agent-1' },
		query: { n8nSessionId: 'session-1', n8nTrajectory: '1' },
	}),
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../composables/useDeepSeekHarnessApi', () => ({
	useDeepSeekHarnessApi: () => ({ getAgent, updateAgent, startStudio, restartStudio }),
}));

vi.mock('@n8n/i18n', () => ({
	useI18n: () => ({ baseText: (key: string) => key }),
}));

vi.mock('@n8n/composables/useToast', () => ({
	useToast: () => ({ showError: vi.fn() }),
}));

vi.mock('@n8n/design-system', async () => {
	const { defineComponent } = await import('vue');
	return {
		N8nInlineTextEdit: defineComponent({
			props: { modelValue: { type: String, required: true } },
			emits: ['update:modelValue'],
			methods: { forceCancel: vi.fn() },
			template:
				'<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
		}),
		N8nLoading: defineComponent({ template: '<span />' }),
	};
});

vi.mock('@/features/core/folders/components/FolderBreadcrumbs.vue', async () => {
	const { defineComponent } = await import('vue');
	return { default: defineComponent({ template: '<div><slot name="append" /></div>' }) };
});

vi.mock('../components/DeepSeekHarnessPublishActions.vue', async () => {
	const { defineComponent } = await import('vue');
	return { default: defineComponent({ template: '<div />' }) };
});

describe('DeepSeekHarnessDetailView', () => {
	beforeEach(() => {
		getAgent.mockResolvedValue({ id: 'agent-1', name: 'Agent' });
		updateAgent.mockResolvedValue({ id: 'agent-1', name: 'Renamed' });
		startStudio.mockClear();
		updateAgent.mockClear();
	});

	it('loads and embeds the native Studio URL', async () => {
		const wrapper = mount(DeepSeekHarnessDetailView);
		await nextTick();
		await nextTick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await nextTick();

		expect(startStudio).toHaveBeenCalledWith('project-1', 'agent-1');
		expect(wrapper.get('[data-test-id="deepseek-harness-studio-container"]').classes()).toContain(
			'studioContainer',
		);
		expect(wrapper.get('[data-test-id="deepseek-harness-studio"]').attributes('src')).toBe(
			'/deepseek-harness-studio/project-1/agent-1/?token=x',
		);
	});

	it('reloads Studio after renaming the active agent', async () => {
		const wrapper = mount(DeepSeekHarnessDetailView);
		await nextTick();
		await nextTick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		await wrapper.get('[data-test-id="deepseek-harness-name-input"]').setValue('Renamed');
		await nextTick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(updateAgent).toHaveBeenCalledWith('project-1', 'agent-1', 'Renamed');
		expect(startStudio).toHaveBeenCalledTimes(2);
		expect(wrapper.get('[data-test-id="deepseek-harness-studio"]').attributes('src')).toBe(
			'/deepseek-harness-studio/project-1/agent-1/?token=x',
		);
	});
});
