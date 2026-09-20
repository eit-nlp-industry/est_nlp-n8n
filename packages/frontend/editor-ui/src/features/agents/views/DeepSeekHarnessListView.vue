<script setup lang="ts">
import { N8nEmptyState } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { InsightsSummary, useInsightsStore } from '@n8n/frontend-module-insights';

import ResourcesListLayout from '@/app/components/layouts/ResourcesListLayout.vue';
import ProjectHeader from '@/features/collaboration/projects/components/ProjectHeader.vue';
import { useProjectPages } from '@/features/collaboration/projects/composables/useProjectPages';

const i18n = useI18n();
const insightsStore = useInsightsStore();
const projectPages = useProjectPages();
const resources: never[] = [];

const initialize = async () => {};
const onCreateClick = () => {};
</script>

<template>
	<ResourcesListLayout
		resource-key="agents"
		type="list-paginated"
		:resources="resources"
		:initialize="initialize"
		:loading="false"
		:disabled="false"
		:resources-refreshing="false"
		:total-items="0"
		:type-props="{ itemSize: 80 }"
		:shareable="false"
		:ui-config="{ searchEnabled: false, showFiltersDropdown: false, sortEnabled: false }"
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
