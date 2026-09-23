<script setup lang="ts">
import type { DeepSeekHarnessAgentDto } from '@n8n/api-types';
import { N8nInlineTextEdit, N8nLoading } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { useToast } from '@n8n/composables/useToast';
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import FolderBreadcrumbs from '@/features/core/folders/components/FolderBreadcrumbs.vue';
import { PROJECT_DEEPSEEK_HARNESS } from '../constants';
import { useDeepSeekHarnessApi } from '../composables/useDeepSeekHarnessApi';
import DeepSeekHarnessPublishActions from '../components/DeepSeekHarnessPublishActions.vue';

const route = useRoute();
const router = useRouter();
const i18n = useI18n();
const toast = useToast();
const { getAgent, updateAgent, startStudio, restartStudio, publishAgent, unpublishAgent } =
	useDeepSeekHarnessApi();
const agent = ref<DeepSeekHarnessAgentDto | null>(null);
const isLoading = ref(true);
const isRestarting = ref(false);
const studioUrl = ref<string>();
const studioError = ref(false);
const renameInput = useTemplateRef<InstanceType<typeof N8nInlineTextEdit>>('renameInput');

const projectId = computed(() => {
	const value = route.params.projectId;
	return Array.isArray(value) ? value[0] : value;
});

const agentId = computed(() => {
	const value = route.params.agentId;
	return Array.isArray(value) ? value[0] : value;
});

function useCurrentHost(url: string): string {
	// Same-origin proxy URLs are returned by the API and must stay as-is.
	if (url.startsWith('/')) return url;
	const studioUrl = new URL(url);
	studioUrl.hostname = window.location.hostname;
	return studioUrl.toString();
}

const onBreadcrumbsItemSelected = () => {
	void router.push({ name: PROJECT_DEEPSEEK_HARNESS, params: { projectId: projectId.value } });
};

const onNameSubmit = async (value: string) => {
	const name = value.trim();
	if (!name || !agent.value || !projectId.value || !agentId.value) {
		renameInput.value?.forceCancel();
		return;
	}
	if (name === agent.value.name) {
		renameInput.value?.forceCancel();
		return;
	}

	const previousStudioUrl = studioUrl.value;
	const shouldReloadStudio = Boolean(previousStudioUrl);
	if (shouldReloadStudio) {
		// The rename restarts Harness. Do not keep an iframe connected to the old process.
		studioUrl.value = undefined;
		studioError.value = false;
	}

	try {
		const updated = await updateAgent(projectId.value, agentId.value, name);
		agent.value = updated;
		if (shouldReloadStudio) {
			const runtime = await startStudio(projectId.value, agentId.value);
			studioUrl.value = useCurrentHost(runtime.url);
		}
	} catch (error) {
		if (shouldReloadStudio && previousStudioUrl) studioUrl.value = previousStudioUrl;
		toast.showError(error, i18n.baseText('folders.rename.error.title'));
		renameInput.value?.forceCancel();
	}
};

const onPublish = async () => {
	if (!projectId.value || !agentId.value) return;
	agent.value = await publishAgent(projectId.value, agentId.value);
};

const onUnpublish = async () => {
	if (!projectId.value || !agentId.value) return;
	agent.value = await unpublishAgent(projectId.value, agentId.value);
};

const onRestart = async () => {
	if (!projectId.value || !agentId.value || isRestarting.value) return;
	isRestarting.value = true;
	studioUrl.value = undefined;
	studioError.value = false;
	try {
		studioUrl.value = useCurrentHost((await restartStudio(projectId.value, agentId.value)).url);
	} catch (error) {
		studioError.value = true;
		toast.showError(error, i18n.baseText('deepseekHarness.studio.restart.error'));
	} finally {
		isRestarting.value = false;
	}
};

onMounted(async () => {
	if (!projectId.value || !agentId.value) return;
	try {
		agent.value = await getAgent(projectId.value, agentId.value);
		studioUrl.value = useCurrentHost((await startStudio(projectId.value, agentId.value)).url);
	} catch (error) {
		studioError.value = true;
		toast.showError(error, i18n.baseText('deepseekHarness.studio.error'));
	} finally {
		isLoading.value = false;
	}
});
</script>

<template>
	<div :class="$style.page">
		<div :class="$style.container" data-test-id="deepseek-harness-breadcrumbs">
			<div :class="$style.nameContainer">
				<FolderBreadcrumbs
					:current-folder="undefined"
					:current-folder-as-link="true"
					@item-selected="onBreadcrumbsItemSelected"
				>
					<template #append>
						<span v-if="agent" :class="$style.pathSeparator">/</span>
						<N8nLoading v-if="isLoading" :rows="1" variant="p" />
						<N8nInlineTextEdit
							v-else-if="agent"
							ref="renameInput"
							:model-value="agent.name"
							:class="$style.name"
							:placeholder="i18n.baseText('folders.rename.placeholder')"
							:max-length="128"
							max-width="100%"
							data-test-id="deepseek-harness-name-input"
							@update:model-value="onNameSubmit"
						/>
					</template>
				</FolderBreadcrumbs>
			</div>
			<span :class="$style.spacer" />
			<DeepSeekHarnessPublishActions
				v-if="agent"
				:agent="agent"
				:restarting="isRestarting"
				:on-publish="onPublish"
				:on-unpublish="onUnpublish"
				:on-restart="onRestart"
			/>
		</div>

		<div :class="$style.studioContainer" data-test-id="deepseek-harness-studio-container">
			<iframe
				v-if="studioUrl"
				:src="studioUrl"
				:class="$style.studio"
				:title="i18n.baseText('deepseekHarness.studio.title')"
				data-test-id="deepseek-harness-studio"
			/>
			<div v-else-if="studioError" :class="$style.error">
				{{ i18n.baseText('deepseekHarness.studio.error') }}
			</div>
		</div>
	</div>
</template>

<style lang="scss" module>
@use '@/app/css/variables' as *;

.page {
	display: flex;
	flex-direction: column;
	height: 100%;
	width: 100%;
	align-self: stretch;
}

.container {
	position: relative;
	width: 100%;
	padding: var(--spacing--xs) var(--spacing--md);
	display: flex;
	align-items: center;
	flex-wrap: nowrap;
	border-bottom: var(--border);
}

.nameContainer {
	margin-right: var(--spacing--sm);
	min-width: 0;

	:deep(.el-input) {
		padding: 0;
	}

	:deep([data-test-id='folder-breadcrumbs'] > div) {
		min-width: 0;
	}

	:deep([data-test-id='home-project']) {
		flex-shrink: 0;
	}
}

.name {
	color: $custom-font-dark;
	font-size: var(--font-size--sm);
	padding: var(--spacing--3xs) var(--spacing--4xs) var(--spacing--4xs);
	min-width: 0;
}

.pathSeparator {
	font-size: var(--font-size--xl);
	color: var(--color--foreground);
	padding: var(--spacing--3xs) var(--spacing--4xs) var(--spacing--4xs);
}

.spacer {
	display: flex;
	align-items: center;
	width: 100%;
	flex: 1;
	min-width: 0;
	margin-right: var(--spacing--md);
}

.studioContainer {
	flex: 1;
	min-height: 0;
}

.studio {
	display: block;
	width: 100%;
	height: 100%;
	border: 0;
}

.error {
	padding: var(--spacing--lg);
	color: var(--color--text--danger);
	text-align: center;
}
</style>
