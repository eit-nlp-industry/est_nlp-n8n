<script setup lang="ts">
import { JsonRenderPanel } from '@eit/json-render-vue';
import { elementPlusRegistry } from '@eit/json-render-element-plus';
import { tryParseJsonRenderPayload, type JsonRenderPayload } from '@eit/json-render-protocol';
import type { ChatMessageContentChunk } from '@n8n/api-types';
import { computed } from 'vue';

const props = defineProps<{
	source: Extract<ChatMessageContentChunk, { type: 'json-render' }>;
}>();

const payload = computed<JsonRenderPayload | null>(() =>
	tryParseJsonRenderPayload(props.source.payload),
);
</script>

<template>
	<div v-if="payload" :class="$style.panel">
		<JsonRenderPanel
			:payload="payload"
			instance-id="chat-hub-json-render"
			:registry="elementPlusRegistry"
		/>
	</div>
</template>

<style lang="scss" module>
.panel {
	width: 100%;
	margin-bottom: var(--spacing--sm);
}
</style>
