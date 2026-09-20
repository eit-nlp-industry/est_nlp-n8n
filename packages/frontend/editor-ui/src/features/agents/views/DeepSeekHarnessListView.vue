<script setup lang="ts">
import { N8nEmptyState } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { InsightsSummary, useInsightsStore } from '@n8n/frontend-module-insights';
import { isRecord } from '@n8n/utils/is-record';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ResourcesListLayout from '@/app/components/layouts/ResourcesListLayout.vue';
import ProjectHeader from '@/features/collaboration/projects/components/ProjectHeader.vue';
import { useProjectPages } from '@/features/collaboration/projects/composables/useProjectPages';
import { useProjectsStore } from '@/features/collaboration/projects/projects.store';
import { MODAL_CONFIRM } from '@/app/constants';
import { useAgentConfirmationModal } from '../composables/useAgentConfirmationModal';
import { PROJECT_DEEPSEEK_HARNESS_AGENT } from '../constants';
import DeepSeekHarnessCard from '../components/DeepSeekHarnessCard.vue';
import { useDeepSeekHarnessApi } from '../composables/useDeepSeekHarnessApi';
import type { DeepSeekHarnessResource } from '../types';

const i18n = useI18n();
const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();
const insightsStore = useInsightsStore();
const projectPages = useProjectPages();
const { createAgent, listAgents, deleteAgent } = useDeepSeekHarnessApi();
const { openAgentConfirmationModal } = useAgentConfirmationModal();
const resources = ref<DeepSeekHarnessResource[]>([]);
const filters = ref({ search: '', homeProject: '' });
const resourcesRefreshing = ref(false);
const currentPage = ref(1);
const pageSize = ref(10);
const currentSort = ref('lastUpdated');

const projectId = computed(
	() => (route.params.projectId as string | undefined) ?? projectsStore.personalProject?.id,
);

const sortFns = {
	lastUpdated: (a: DeepSeekHarnessResource, b: DeepSeekHarnessResource) =>
		new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
	lastCreated: (a: DeepSeekHarnessResource, b: DeepSeekHarnessResource) =>
		new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	nameAsc: (a: DeepSeekHarnessResource, b: DeepSeekHarnessResource) =>
		a.name.localeCompare(b.name),
	nameDesc: (a: DeepSeekHarnessResource, b: DeepSeekHarnessResource) =>
		b.name.localeCompare(a.name),
};

const filteredResources = computed(() => {
	const search = filters.value.search.trim().toLowerCase();
	const filtered = resources.value.filter((resource) =>
		search ? resource.name.toLowerCase().includes(search) : true,
	);

	return [...filtered].sort(
		sortFns[currentSort.value as keyof typeof sortFns] ?? sortFns.lastUpdated,
	);
});

const visibleResources = computed(() => {
	const start = (currentPage.value - 1) * pageSize.value;
	return filteredResources.value.slice(start, start + pageSize.value);
});

function isDeepSeekHarnessResource(value: unknown): value is DeepSeekHarnessResource {
	return isRecord(value) && value.resourceType === 'deepseekHarness';
}

const initialize = async () => {
	if (!projectId.value) {
		return;
	}

	resourcesRefreshing.value = resources.value.length > 0;
	try {
		resources.value = (await listAgents(projectId.value)).map((agent) => ({
			...agent,
			resourceType: 'deepseekHarness' as const,
		}));
		currentPage.value = 1;
	} finally {
		resourcesRefreshing.value = false;
	}
};

const onPaginationAndSort = (payload: { page?: number; pageSize?: number; sort?: string }) => {
	if (payload.page) currentPage.value = payload.page;
	if (payload.pageSize) pageSize.value = payload.pageSize;
	if (payload.sort) currentSort.value = payload.sort;
};

watch(
		() => filters.value.search,
		() => {
			currentPage.value = 1;
		},
);

const onCreateClick = async () => {
	if (!projectId.value) return;
	const agent = await createAgent(projectId.value);
	await router.push({
		name: PROJECT_DEEPSEEK_HARNESS_AGENT,
		params: { projectId: projectId.value, agentId: agent.id },
	});
};

const onDeleteClick = async (agentId: string) => {
	const agent = resources.value.find((resource) => resource.id === agentId);
	if (!agent || !projectId.value) return;

	const confirmed = await openAgentConfirmationModal({
		title: i18n.baseText('deepseekHarness.delete.modal.title'),
		description: i18n.baseText('deepseekHarness.delete.modal.description', {
			interpolate: { name: agent.name },
		}),
		confirmButtonText: i18n.baseText('deepseekHarness.delete.modal.confirm'),
		cancelButtonText: i18n.baseText('generic.cancel'),
	});
	if (confirmed !== MODAL_CONFIRM) return;

	await deleteAgent(projectId.value, agentId);
	resources.value = resources.value.filter((resource) => resource.id !== agentId);
	if (currentPage.value > 1 && visibleResources.value.length === 0) currentPage.value -= 1;
};

const onOpenClick = (agentId: string) => {
	if (!projectId.value) return;
	void router.push({
		name: PROJECT_DEEPSEEK_HARNESS_AGENT,
		params: { projectId: projectId.value, agentId },
	});
};

</script>

<template>
	<ResourcesListLayout
		v-model:filters="filters"
		resource-key="agents"
		type="list-paginated"
		:resources="visibleResources"
		:initialize="initialize"
		:loading="false"
		:disabled="false"
		:resources-refreshing="resourcesRefreshing"
		:sort-fns="sortFns"
		:sort-options="['lastUpdated', 'lastCreated', 'nameAsc', 'nameDesc']"
		:total-items="filteredResources.length"
		:type-props="{ itemSize: 80 }"
		:custom-page-size="10"
		:dont-perform-sorting-and-filtering="true"
		:shareable="false"
		:ui-config="{ searchEnabled: true, showFiltersDropdown: false, sortEnabled: true }"
		:display-name="(agent: DeepSeekHarnessResource) => agent.name"
		@update:pagination-and-sort="onPaginationAndSort"
	>
		<template #header>
			<ProjectHeader main-button="deepseekHarness">
				<InsightsSummary
					v-if="projectPages.isOverviewSubPage && insightsStore.isSummaryEnabled"
					:loading="insightsStore.weeklySummary.isLoading"
					:summary="insightsStore.weeklySummary.state"
					time-range="week"
				/>
			</ProjectHeader>
		</template>

		<template #item="{ item: data }">
			<DeepSeekHarnessCard
				v-if="isDeepSeekHarnessResource(data)"
				:agent="data"
				@delete="onDeleteClick"
				@open="onOpenClick"
			/>
		</template>

		<template #empty>
			<N8nEmptyState
				data-test-id="deepseek-harness-empty-state"
				:icon="{ type: 'icon', value: 'robot' }"
				:heading="i18n.baseText('deepseekHarness.empty.heading')"
				:description="i18n.baseText('deepseekHarness.empty.description')"
				:button-text="i18n.baseText('deepseekHarness.empty.createButton')"
				@click:button="onCreateClick"
			/>
		</template>
	</ResourcesListLayout>
</template>
