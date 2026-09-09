<script setup lang="ts">
import { JsonRenderPanel } from '@eit/json-render-vue';
import { elementPlusRegistry } from '@eit/json-render-element-plus';
import type { JsonRenderPayload } from '@eit/json-render-protocol';

defineProps<{
	payload: JsonRenderPayload;
	instanceId: string;
}>();
</script>

<template>
	<JsonRenderPanel :payload="payload" :instance-id="instanceId" :registry="elementPlusRegistry" />
</template>
