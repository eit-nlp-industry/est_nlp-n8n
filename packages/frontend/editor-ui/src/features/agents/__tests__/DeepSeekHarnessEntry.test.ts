import { mount } from '@vue/test-utils';
import { vi } from 'vitest';

import {
	AGENTS_LIST_VIEW,
	DEEPSEEK_HARNESS_LIST_VIEW,
	PROJECT_AGENTS,
	PROJECT_DEEPSEEK_HARNESS,
	PROJECT_DEEPSEEK_HARNESS_AGENT,
} from '../constants';
import { AgentsModule } from '../module.descriptor';
import DeepSeekHarnessListView from '../views/DeepSeekHarnessListView.vue';

const routerPush = vi.fn();

vi.mock('vue-router', () => ({
	useRoute: () => ({ params: {} }),
	useRouter: () => ({ push: routerPush }),
}));

vi.mock('../composables/useDeepSeekHarnessApi', () => ({
	useDeepSeekHarnessApi: () => ({
		createAgent: vi.fn().mockResolvedValue({ id: 'agent-1' }),
		listAgents: vi.fn().mockResolvedValue([]),
		deleteAgent: vi.fn(),
	}),
}));

vi.mock('../composables/useAgentConfirmationModal', () => ({
	useAgentConfirmationModal: () => ({ openAgentConfirmationModal: vi.fn() }),
}));

vi.mock('@/features/collaboration/projects/projects.store', () => ({
	useProjectsStore: () => ({ currentProject: null, personalProject: { id: 'personal-project' } }),
}));

vi.mock('@/features/collaboration/projects/components/ProjectHeader.vue', async () => {
	const { defineComponent } = await import('vue');
	return {
		default: defineComponent({
			props: ['mainButton'],
			template: `
				<div data-test-id="project-header" :data-main-button="mainButton">
					<slot />
				</div>
			`,
		}),
	};
});

vi.mock('@n8n/frontend-module-insights', async () => {
	const { defineComponent } = await import('vue');
	return {
		InsightsSummary: defineComponent({
			name: 'InsightsSummary',
			template: '<div data-test-id="insights-summary" />',
		}),
		useInsightsStore: () => ({
			isSummaryEnabled: true,
			weeklySummary: { isLoading: false, state: null },
		}),
	};
});

vi.mock('@/features/collaboration/projects/composables/useProjectPages', () => ({
	useProjectPages: () => ({ isOverviewSubPage: true }),
}));

vi.mock('@/app/components/layouts/ResourcesListLayout.vue', async () => {
	const { defineComponent } = await import('vue');
	return {
		default: defineComponent({
			template: `
				<div data-test-id="resources-list-layout">
					<slot name="header" />
					<slot name="empty" />
				</div>
			`,
		}),
	};
});

vi.mock('@n8n/design-system', async () => {
	const { defineComponent } = await import('vue');
	return {
		N8nEmptyState: defineComponent({
			props: ['heading', 'description', 'buttonText', 'buttonDisabled', 'calloutText'],
			emits: ['click:button'],
			template: `
				<div>
					<h1>{{ heading }}</h1>
					<p>{{ description }}</p>
					<button :disabled="buttonDisabled" @click="$emit('click:button')">{{ buttonText }}</button>
			<p v-if="calloutText">{{ calloutText }}</p>
				</div>
			`,
		}),
	};
});

describe('DeepSeek Harness entry', () => {
	it('registers the overview and project tabs after Agents', async () => {
		const overviewRoute = AgentsModule.routes?.find(
			(route) => route.name === DEEPSEEK_HARNESS_LIST_VIEW,
		);
		const projectRoute = AgentsModule.routes?.find(
			(route) => route.name === PROJECT_DEEPSEEK_HARNESS,
		);

		expect(overviewRoute).toMatchObject({
			name: DEEPSEEK_HARNESS_LIST_VIEW,
			path: '/home/deepseek-harness',
			meta: { middleware: ['authenticated', 'custom'] },
		});
		expect(projectRoute).toMatchObject({
			name: PROJECT_DEEPSEEK_HARNESS,
			path: 'deepseek-harness',
			meta: { projectRoute: true, middleware: ['authenticated', 'custom'] },
		});
		expect(overviewRoute?.component).toBeTypeOf('function');
		expect(projectRoute?.component).toBeTypeOf('function');
		expect(AgentsModule.projectTabs?.overview).toContainEqual({
			label: 'DeepSeek Harness',
			value: DEEPSEEK_HARNESS_LIST_VIEW,
			preview: true,
			insertAfter: AGENTS_LIST_VIEW,
			to: { name: DEEPSEEK_HARNESS_LIST_VIEW },
		});
		expect(AgentsModule.projectTabs?.project).toContainEqual({
			label: 'DeepSeek Harness',
			value: PROJECT_DEEPSEEK_HARNESS,
			preview: true,
			insertAfter: PROJECT_AGENTS,
			dynamicRoute: { name: PROJECT_DEEPSEEK_HARNESS, includeProjectId: true },
		});

	});

	it('shows the active creation action in the Agent-style empty state', () => {
		const wrapper = mount(DeepSeekHarnessListView);
		expect(wrapper.find('[data-test-id="resources-list-layout"]').exists()).toBe(true);
		expect(wrapper.get('[data-test-id="project-header"]').attributes('data-main-button')).toBe(
			'deepseekHarness',
		);
		expect(wrapper.find('[data-test-id="insights-summary"]').exists()).toBe(true);
		expect(wrapper.get('h1').text()).toBe('Create your first DeepSeek Harness');
		expect(wrapper.findAll('p')[0].text()).toBe(
			'Create a DeepSeek Harness agent to configure and run it in n8n.',
		);
		expect(wrapper.get('button').text()).toBe('Create DeepSeek Harness');
		expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
		expect(wrapper.findAll('p')).toHaveLength(1);
	});

	it('creates an agent and opens its detail route', async () => {
		const wrapper = mount(DeepSeekHarnessListView);

		await wrapper.get('button').trigger('click');

		expect(routerPush).toHaveBeenCalledWith({
			name: PROJECT_DEEPSEEK_HARNESS_AGENT,
			params: { projectId: 'personal-project', agentId: 'agent-1' },
		});
	});
});
