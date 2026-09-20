import { VIEWS } from '@/app/constants';
import { defineFrontendModule } from '@n8n/frontend-module-sdk';
import {
	AGENTS_LIST_VIEW,
	AGENT_BUILDER_VIEW,
	AGENT_PREVIEW_VIEW,
	AGENT_VIEW,
	AGENT_SESSIONS_LIST_VIEW,
	AGENT_SESSION_DETAIL_VIEW,
	DEEPSEEK_HARNESS_LIST_VIEW,
	PROJECT_DEEPSEEK_HARNESS,
	PROJECT_AGENTS,
} from '@/features/agents/constants';
import { AGENTS_MODALS } from '@/features/agents/modals';

const AgentsListView = async (): Promise<unknown> =>
	await import('@/features/agents/views/AgentsListView.vue');
const AgentView = async (): Promise<unknown> =>
	await import('@/features/agents/views/AgentView.vue');
const AgentBuilderView = async (): Promise<unknown> =>
	await import('@/features/agents/views/AgentBuilderView.vue');
const AgentSessionsListView = async (): Promise<unknown> =>
	await import('@/features/agents/views/AgentSessionsListView.vue');
const AgentSessionTimelineView = async (): Promise<unknown> =>
	await import('@/features/agents/views/AgentSessionTimelineView.vue');
const DeepSeekHarnessListView = async (): Promise<unknown> =>
	await import('@/features/agents/views/DeepSeekHarnessListView.vue');

export const AgentsModule = defineFrontendModule({
	id: 'agents',
	name: 'Agents',
	description: 'Build and manage AI agents',
	icon: 'robot',
	modals: AGENTS_MODALS,
	routes: [
		{
			name: AGENTS_LIST_VIEW,
			path: '/home/agents',
			component: AgentsListView,
			meta: {
				middleware: ['authenticated', 'custom'],
			},
		},
		{
			name: PROJECT_AGENTS,
			path: 'agents',
			component: AgentsListView,
			meta: {
				projectRoute: true,
				middleware: ['authenticated', 'custom'],
			},
		},
		{
			name: DEEPSEEK_HARNESS_LIST_VIEW,
			path: '/home/deepseek-harness',
			component: DeepSeekHarnessListView,
			meta: {
				middleware: ['authenticated', 'custom'],
			},
		},
		{
			name: PROJECT_DEEPSEEK_HARNESS,
			path: 'deepseek-harness',
			component: DeepSeekHarnessListView,
			meta: {
				projectRoute: true,
				middleware: ['authenticated', 'custom'],
			},
		},
		{
			name: AGENT_VIEW,
			path: 'agents/:agentId',
			component: AgentView,
			meta: {
				projectRoute: true,
				middleware: ['authenticated', 'custom'],
			},
			children: [
				{
					name: AGENT_BUILDER_VIEW,
					path: '',
					props: true,
					component: AgentBuilderView,
				},
				{
					name: AGENT_PREVIEW_VIEW,
					path: 'preview',
					props: true,
					component: AgentBuilderView,
				},
				{
					name: AGENT_SESSIONS_LIST_VIEW,
					path: 'sessions',
					component: AgentSessionsListView,
				},
				{
					name: AGENT_SESSION_DETAIL_VIEW,
					path: 'sessions/:threadId',
					component: AgentSessionTimelineView,
				},
			],
		},
	],
	projectTabs: {
		overview: [
			{
				label: 'Agents',
				value: AGENTS_LIST_VIEW,
				preview: true,
				insertAfter: VIEWS.WORKFLOWS,
				to: {
					name: AGENTS_LIST_VIEW,
				},
			},
			{
				label: 'DeepSeek Harness',
				value: DEEPSEEK_HARNESS_LIST_VIEW,
				preview: true,
				insertAfter: AGENTS_LIST_VIEW,
				to: {
					name: DEEPSEEK_HARNESS_LIST_VIEW,
				},
			},
		],
		project: [
			{
				label: 'Agents',
				value: PROJECT_AGENTS,
				preview: true,
				insertAfter: VIEWS.PROJECTS_WORKFLOWS,
				dynamicRoute: {
					name: PROJECT_AGENTS,
					includeProjectId: true,
				},
			},
			{
				label: 'DeepSeek Harness',
				value: PROJECT_DEEPSEEK_HARNESS,
				preview: true,
				insertAfter: PROJECT_AGENTS,
				dynamicRoute: {
					name: PROJECT_DEEPSEEK_HARNESS,
					includeProjectId: true,
				},
			},
		],
	},
	resources: [
		{
			key: 'agent',
			displayName: 'Agent',
		},
	],
});
