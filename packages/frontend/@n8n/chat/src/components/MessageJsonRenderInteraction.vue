<script setup lang="ts">
import type { JsonRenderPayload } from '@eit/json-render-protocol';
import { v4 as uuidv4 } from 'uuid';
import { inject, ref } from 'vue';

import { useI18n } from '../composables/useI18n';
import { ChatSymbol } from '../constants/symbols';
import type { Chat } from '../types';
import JsonRenderInteraction from './JsonRenderInteraction.vue';

const props = defineProps<{
	payload: JsonRenderPayload;
	resolved?: { approved: boolean; value?: Record<string, unknown> };
}>();

const chat = inject(ChatSymbol) as Chat;
const { t } = useI18n();
const instanceId = `chat-widget-json-render-interaction-${uuidv4()}`;
const submitted = ref(Boolean(props.resolved));
const submittedValues = ref<Record<string, unknown> | undefined>(props.resolved?.value);
const status = ref<'open' | 'submitted' | 'cancelled'>(
	props.resolved ? (props.resolved.approved ? 'submitted' : 'cancelled') : 'open',
);

async function submitDecision(approved: boolean, value?: Record<string, unknown>) {
	if (submitted.value) return;
	submitted.value = true;
	submittedValues.value = approved ? value : undefined;
	status.value = approved ? 'submitted' : 'cancelled';

	const body = JSON.stringify({
		type: 'json-render-interaction-response',
		approved,
		value: approved ? value : undefined,
	});

	chat.messages.value.push({
		id: uuidv4(),
		text: approved ? t('jsonRenderSubmittedDecision') : t('jsonRenderCancelled'),
		sender: 'user',
	});

	if (chat.ws) {
		chat.ws.send(
			JSON.stringify({
				sessionId: chat.currentSessionId.value,
				action: 'sendMessage',
				chatInput: body,
			}),
		);
		chat.waitingForResponse.value = true;
		chat.blockUserInput.value = false;
		return;
	}

	await chat.sendMessage(body, [], { addToTranscript: false });
}
</script>

<template>
	<JsonRenderInteraction
		:payload="payload"
		:instance-id="instanceId"
		:values="submittedValues"
		:read-only="submitted"
		:status="status"
		@submit="submitDecision(true, $event)"
		@cancel="submitDecision(false)"
	/>
</template>
