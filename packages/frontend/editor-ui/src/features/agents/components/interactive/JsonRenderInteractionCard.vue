<script setup lang="ts">
import { useI18n } from '@n8n/i18n';
import { computed } from 'vue';

import JsonRenderInteractionPanel from '@/features/ai/shared/JsonRenderInteractionPanel.vue';
import { extractJsonRenderPayload } from '@/features/ai/shared/jsonRender.utils';
import type {
	JsonRenderInteractionInput,
	JsonRenderInteractionResume,
} from '@/features/ai/shared/agentsChat/types';

const i18n = useI18n();
const props = defineProps<{
	input: JsonRenderInteractionInput;
	instanceId: string;
	resolvedValue?: JsonRenderInteractionResume;
	disabled?: boolean;
}>();

const emit = defineEmits<{
	submit: [resumeData: JsonRenderInteractionResume];
}>();

const payload = computed(() => extractJsonRenderPayload(props.input.jsonRender));

function onSubmit(value: Record<string, unknown>) {
	if (props.disabled) return;
	emit('submit', { approved: true, value });
}

function onCancel() {
	if (props.disabled) return;
	emit('submit', { approved: false });
}
</script>

<template>
	<div data-testid="agent-json-render-interaction-card">
		<JsonRenderInteractionPanel
			v-if="payload"
			:payload="payload"
			:instance-id="instanceId"
			:intro-message="input.message"
			:disabled="disabled"
			:values="resolvedValue?.value"
			:status="resolvedValue ? (resolvedValue.approved ? 'submitted' : 'cancelled') : 'open'"
			@submit="onSubmit"
			@cancel="onCancel"
		/>
		<div v-else role="alert">{{ i18n.baseText('agents.chat.jsonRender.invalidPayload') }}</div>
	</div>
</template>
