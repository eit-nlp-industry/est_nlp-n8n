<script setup lang="ts">
import type { JsonRenderPayload } from '@eit/json-render-protocol';
import { v4 as uuidv4 } from 'uuid';
import { inject, ref } from 'vue';

import { useI18n } from '../composables/useI18n';
import { MessageComponentKey } from '../constants/messageComponents';
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
const pendingBody = ref<string>();
const pendingApproval = ref(false);
const sending = ref(false);
const sendFailed = ref(false);
const status = ref<'open' | 'submitted' | 'cancelled'>(
	props.resolved ? (props.resolved.approved ? 'submitted' : 'cancelled') : 'open',
);

async function sendDecision() {
	if (!pendingBody.value || sending.value) return;
	sending.value = true;
	sendFailed.value = false;
	try {
		if (chat.ws) {
			if (chat.ws.readyState !== WebSocket.OPEN) throw new Error('Chat connection is not open');
			chat.ws.send(
				JSON.stringify({
					sessionId: chat.currentSessionId.value,
					action: 'sendMessage',
					chatInput: pendingBody.value,
				}),
			);
			chat.waitingForResponse.value = true;
			chat.blockUserInput.value = false;
		} else {
			await chat.sendMessage(pendingBody.value, [], {
				addToTranscript: false,
				throwOnError: true,
			});
		}
		status.value = pendingApproval.value ? 'submitted' : 'cancelled';
		const message = chat.messages.value.find(
			(item) =>
				item.type === 'component' &&
				item.key === MessageComponentKey.JSON_RENDER_INTERACTION &&
				item.arguments.payload === props.payload &&
				!item.arguments.resolved,
		);
		if (message?.type === 'component') {
			message.arguments = {
				...message.arguments,
				resolved: {
					approved: pendingApproval.value,
					value: pendingApproval.value ? submittedValues.value : undefined,
				},
			};
		}
	} catch {
		sendFailed.value = true;
	} finally {
		sending.value = false;
	}
}

async function submitDecision(approved: boolean, value?: Record<string, unknown>) {
	if (submitted.value) return;
	submitted.value = true;
	submittedValues.value = approved ? value : undefined;
	pendingApproval.value = approved;

	pendingBody.value = JSON.stringify({
		type: 'json-render-interaction-response',
		approved,
		value: approved ? value : undefined,
	});

	chat.messages.value.push({
		id: uuidv4(),
		text: approved ? t('jsonRenderSubmittedDecision') : t('jsonRenderCancelled'),
		sender: 'user',
	});

	await sendDecision();
}
</script>

<template>
	<div>
		<JsonRenderInteraction
			:payload="payload"
			:instance-id="instanceId"
			:values="submittedValues"
			:read-only="submitted"
			:status="status"
			@submit="submitDecision(true, $event)"
			@cancel="submitDecision(false)"
		/>
		<div v-if="sendFailed" class="json-render-interaction-retry" role="alert">
			<span>{{ t('jsonRenderSendFailed') }}</span>
			<button
				type="button"
				data-test-id="retry-interaction"
				:disabled="sending"
				@click="sendDecision"
			>
				{{ t('jsonRenderRetry') }}
			</button>
		</div>
	</div>
</template>

<style scoped>
.json-render-interaction-retry {
	color: var(--color--danger, var(--el-color-danger, #f56c6c));
}

.json-render-interaction-retry button {
	margin-left: var(--spacing--xs, 0.75rem);
	color: inherit;
	text-decoration: underline;
}
</style>
