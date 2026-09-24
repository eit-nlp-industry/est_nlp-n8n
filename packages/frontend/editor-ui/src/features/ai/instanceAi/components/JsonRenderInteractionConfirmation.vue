<script setup lang="ts">
import { N8nCard, N8nText } from '@n8n/design-system';
import type { InstanceAiConfirmation } from '@n8n/api-types';
import type { JsonRenderPayload } from '@eit/json-render-protocol';
import { computed, ref } from 'vue';
import JsonRenderInteractionPanel from '@/features/ai/shared/JsonRenderInteractionPanel.vue';
import { useThread } from '../instanceAi.store';

const props = defineProps<{
	confirmation: InstanceAiConfirmation;
}>();

const thread = useThread();

const payload = computed(() => props.confirmation.jsonRender as JsonRenderPayload | undefined);
const values = ref<Record<string, unknown>>();
const status = ref<'open' | 'submitted' | 'cancelled'>('open');

function handleSubmit(value: Record<string, unknown>) {
	values.value = value;
	status.value = 'submitted';
	thread.interactionDecisions.set(props.confirmation.requestId, {
		status: 'submitted',
		values: value,
	});
	thread.resolveConfirmation(props.confirmation.requestId, 'approved');
	void thread.confirmAction(props.confirmation.requestId, {
		kind: 'interaction',
		approved: true,
		value,
	});
}

function handleCancel() {
	status.value = 'cancelled';
	thread.interactionDecisions.set(props.confirmation.requestId, { status: 'cancelled' });
	thread.resolveConfirmation(props.confirmation.requestId, 'denied');
	void thread.confirmAction(props.confirmation.requestId, {
		kind: 'interaction',
		approved: false,
	});
}
</script>

<template>
	<N8nCard v-if="payload" data-test-id="instance-ai-json-render-interaction">
		<N8nText v-if="confirmation.message" tag="div" bold :class="$style.message">
			{{ confirmation.message }}
		</N8nText>
		<JsonRenderInteractionPanel
			:payload="payload"
			:instance-id="`hitl-${confirmation.requestId}`"
			:intro-message="confirmation.introMessage"
			:values="values"
			:disabled="status !== 'open'"
			:status="status"
			@submit="handleSubmit"
			@cancel="handleCancel"
		/>
	</N8nCard>
</template>

<style lang="scss" module>
.message {
	margin-bottom: var(--spacing--sm);
}
</style>
