<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { INodeCreateElement, NodeTypeSelectedPayload } from '@/Interface';
import { CHAT_TRIGGER_NODE_TYPE, DEEPSEEK_HARNESS_NODE_TYPE, DEBOUNCE_TIME } from '@/app/constants';
import { useUIStore } from '@/app/stores/ui.store';
import { injectWorkflowDocumentStore } from '@/app/stores/workflowDocument.store';
import { useAgentScopeProjectId } from '@/features/agents/composables/useAgentScopeProjectId';
import { useDeepSeekHarnessApi } from '@/features/agents/composables/useDeepSeekHarnessApi';
import { getDebounceTime, useDebounce } from '@n8n/composables/useDebounce';
import { useNodeCreatorStore } from '@/features/shared/nodeCreator/nodeCreator.store';
import { useActions } from '../../composables/useActions';
import { useKeyboardNavigation } from '../../composables/useKeyboardNavigation';
import { useViewStacks } from '../../composables/useViewStacks';
import ItemsRenderer from '../Renderers/ItemsRenderer.vue';
import { useI18n } from '@n8n/i18n';
import { N8nLink, N8nLoading, N8nText } from '@n8n/design-system';

const emit = defineEmits<{ nodeTypeSelected: [value: NodeTypeSelectedPayload[]] }>();
const i18n = useI18n();
const { debounce } = useDebounce();
const { popViewStack, updateCurrentViewStack } = useViewStacks();
const { registerKeyHook } = useKeyboardNavigation();
const { setAddedNodeActionParameters, shouldPrependChatTrigger } = useActions();
const nodeCreatorStore = useNodeCreatorStore();
const uiStore = useUIStore();
const workflowDocumentStore = injectWorkflowDocumentStore();
const projectId = useAgentScopeProjectId();
const { listAgents } = useDeepSeekHarnessApi();
const resources = ref<Array<{ id: string; name: string }>>([]);
const isLoading = ref(false);
const loadError = ref(false);
const search = computed(() => useViewStacks().activeViewStack.search ?? '');

async function load() {
	isLoading.value = true;
	loadError.value = false;
	try {
		const agents = await listAgents(projectId.value);
		const query = search.value.trim().toLowerCase();
		resources.value = agents
			.filter((agent) => !query || agent.name.toLowerCase().includes(query))
			.map((agent) => ({ id: agent.id, name: agent.name }));
	} catch {
		loadError.value = true;
	} finally {
		isLoading.value = false;
	}
}

const debouncedLoad = debounce(
	() => {
		load();
	},
	{
		debounceTime: getDebounceTime(DEBOUNCE_TIME.INPUT.SEARCH),
		trailing: true,
	},
);
watch(search, () => debouncedLoad());

const elements = computed<INodeCreateElement[]>(() =>
	resources.value.map((agent) => ({
		key: agent.id,
		uuid: `deepseek-harness-${agent.id}`,
		type: 'agent',
		properties: { name: agent.name, variant: 'existing', agentId: agent.id },
	})),
);

function chatInputMessagePreset(): { message?: string } {
	const willAutoAddChatTrigger = shouldPrependChatTrigger([{ type: DEEPSEEK_HARNESS_NODE_TYPE }]);
	const lastNode = uiStore.lastInteractedWithNodeId
		? workflowDocumentStore.value.getNodeById(uiStore.lastInteractedWithNodeId)
		: undefined;
	return willAutoAddChatTrigger || lastNode?.type === CHAT_TRIGGER_NODE_TYPE
		? { message: '={{ $json.chatInput }}' }
		: {};
}

function onSelected(element: INodeCreateElement) {
	if (element.type !== 'agent' || !element.properties.agentId) return;
	const messagePreset = chatInputMessagePreset();
	emit('nodeTypeSelected', [{ type: DEEPSEEK_HARNESS_NODE_TYPE }]);
	setAddedNodeActionParameters({
		name: element.properties.name,
		key: DEEPSEEK_HARNESS_NODE_TYPE,
		value: {
			agentId: {
				__rl: true,
				mode: 'list',
				value: element.properties.agentId,
				cachedResultName: element.properties.name,
			},
			...messagePreset,
		},
	});
	nodeCreatorStore.onAgentPanelOptionSelected({ choice: 'existing_agent' });
}

function onKeySelect(activeItemId: string) {
	const element = elements.value.find((item) => item.uuid === activeItemId);
	if (element) onSelected(element);
}

registerKeyHook('DeepSeekHarnessModeSelect', {
	keyboardKeys: ['ArrowRight', 'Enter'],
	condition: (type) => type === 'agent',
	handler: onKeySelect,
});
registerKeyHook('DeepSeekHarnessModeLeft', {
	keyboardKeys: ['ArrowLeft'],
	condition: (type) => type === 'agent',
	handler: () => popViewStack(),
});

function resetSearch() {
	updateCurrentViewStack({ search: '' });
}

onMounted(() => {
	load();
});
</script>

<template>
	<div :class="$style.container" data-test-id="node-creator-deepseek-harness-panel">
		<N8nLoading
			v-if="isLoading && elements.length === 0"
			:class="$style.state"
			:loading="true"
			:rows="3"
			variant="p"
		/>
		<div v-else-if="loadError" :class="$style.state">
			<N8nText size="small" color="text-base">{{
				i18n.baseText('nodeCreator.deepSeekHarnessPanel.loadError')
			}}</N8nText>
			<N8nLink size="small" @click="load">{{ i18n.baseText('generic.retry') }}</N8nLink>
		</div>
		<div v-else-if="elements.length === 0" :class="$style.state">
			<N8nText size="small" color="text-base">{{
				i18n.baseText('nodeCreator.deepSeekHarnessPanel.empty')
			}}</N8nText>
			<N8nLink v-if="search" size="small" @click="resetSearch">{{
				i18n.baseText('generic.clear')
			}}</N8nLink>
		</div>
		<ItemsRenderer v-else :elements="elements" @selected="onSelected" />
	</div>
</template>

<style lang="scss" module>
.container {
	display: flex;
	flex-direction: column;
	padding-bottom: var(--spacing--xl);
}
.state {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--3xs);
	padding: var(--spacing--2xs) var(--spacing--sm);
}
</style>
