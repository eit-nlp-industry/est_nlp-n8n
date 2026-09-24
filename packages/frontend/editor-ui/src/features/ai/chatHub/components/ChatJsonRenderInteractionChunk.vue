<script setup lang="ts">
import { tryParseJsonRenderPayload } from '@eit/json-render-protocol';
import type { ChatMessageContentChunk } from '@n8n/api-types';
import { N8nText } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { computed, ref, useId } from 'vue';

import JsonRenderInteractionPanel from '@/features/ai/shared/JsonRenderInteractionPanel.vue';

const props = defineProps<{
	source: Extract<ChatMessageContentChunk, { type: 'json-render-interaction' }>;
	disabled: boolean;
	submitDecision: (approved: boolean, value?: Record<string, unknown>) => Promise<void>;
}>();

const i18n = useI18n();
const instanceId = `chat-hub-json-render-interaction-${useId()}`;
const payload = computed(() => tryParseJsonRenderPayload(props.source.payload));
const resolved = ref<{ approved: boolean; value?: Record<string, unknown> }>();
const sending = ref(false);
const sendFailed = ref(false);

async function submit(approved: boolean, value?: Record<string, unknown>) {
	if (resolved.value || sending.value) return;

	sending.value = true;
	sendFailed.value = false;
	try {
		await props.submitDecision(approved, value);
		resolved.value = { approved, value: approved ? value : undefined };
	} catch {
		sendFailed.value = true;
	} finally {
		sending.value = false;
	}
}
</script>

<template>
	<div v-if="payload">
		<JsonRenderInteractionPanel
			:payload="payload"
			:instance-id="instanceId"
			:disabled="disabled || sending || Boolean(resolved)"
			:values="resolved?.value"
			:status="resolved ? (resolved.approved ? 'submitted' : 'cancelled') : 'open'"
			@submit="submit(true, $event)"
			@cancel="submit(false)"
		/>
		<N8nText v-if="sendFailed" color="danger" size="small">
			{{ i18n.baseText('chatHub.message.jsonRender.sendFailed') }}
		</N8nText>
	</div>
</template>
