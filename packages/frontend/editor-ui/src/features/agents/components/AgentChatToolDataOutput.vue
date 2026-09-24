<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';

import { extractJsonRenderPayload } from '@/features/ai/shared/jsonRender.utils';

const JsonRenderToolResult = defineAsyncComponent(
	async () => await import('@/features/ai/instanceAi/components/JsonRenderToolResult.vue'),
);

const props = defineProps<{
	value: unknown;
	instanceId: string;
}>();

const payload = computed(() => extractJsonRenderPayload(props.value));

function formatToolData(value: unknown): string {
	if (typeof value === 'string') return value;
	return JSON.stringify(value, null, 2) ?? String(value);
}
</script>

<template>
	<div v-if="payload" data-testid="agent-chat-json-render-output">
		<JsonRenderToolResult :payload="payload" :instance-id="instanceId" />
	</div>
	<pre v-else :class="$style.toolDataContent">{{ formatToolData(value) }}</pre>
</template>

<style module>
.toolDataContent {
	margin: 0;
	font-family: monospace;
	font-size: var(--font-size--xs);
	line-height: var(--line-height--sm);
	color: var(--text-color);
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	user-select: text;
}
</style>
