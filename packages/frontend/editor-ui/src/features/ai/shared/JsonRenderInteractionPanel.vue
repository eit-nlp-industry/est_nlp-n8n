<script setup lang="ts">
import type { JsonRenderPayload } from '@eit/json-render-protocol';
import { N8nText } from '@n8n/design-system';
import JsonRenderInteraction from '@n8n/chat/components/JsonRenderInteraction.vue';

withDefaults(
	defineProps<{
		payload: JsonRenderPayload;
		instanceId: string;
		introMessage?: string;
		disabled?: boolean;
		values?: Record<string, unknown>;
		status?: 'open' | 'submitted' | 'cancelled';
	}>(),
	{ disabled: false, status: 'open' },
);

defineEmits<{
	submit: [value: Record<string, unknown>];
	cancel: [];
}>();
</script>

<template>
	<div :class="$style.root" data-testid="json-render-interaction-panel">
		<N8nText v-if="introMessage" tag="div" size="small" color="text-light">
			{{ introMessage }}
		</N8nText>
		<div :class="$style.formHost">
			<JsonRenderInteraction
				:payload="payload"
				:instance-id="instanceId"
				:values="values"
				:read-only="disabled"
				:status="status"
				@submit="$emit('submit', $event)"
				@cancel="$emit('cancel')"
			/>
		</div>
	</div>
</template>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--md);
	width: 100%;
	overflow: visible;
}

/*
 * n8n host surface for interaction forms. Field chrome lives in
 * @n8n/chat JsonRenderInteraction; this wrapper only applies editor tokens
 * and keeps overflow visible so teleported selects are not clipped by chat.
 */
.formHost {
	width: 100%;
	overflow: visible;
	isolation: isolate;
}
</style>
