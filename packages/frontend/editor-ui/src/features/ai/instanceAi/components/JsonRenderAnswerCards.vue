<script lang="ts" setup>
import { N8nSpinner, N8nText } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import { computed, defineAsyncComponent } from 'vue';

import {
	extractJsonRenderPayload,
	type JsonRenderCardToolCall,
} from '@/features/ai/shared/jsonRender.utils';
import ToolResultJson from './ToolResultJson.vue';

const i18n = useI18n();
const JsonRenderToolResult = defineAsyncComponent(
	async () => await import('./JsonRenderToolResult.vue'),
);

const props = defineProps<{
	toolCalls: JsonRenderCardToolCall[];
}>();

const cards = computed(() =>
	props.toolCalls.map((toolCall) => ({
		id: toolCall.toolCallId,
		loading: Boolean(toolCall.isLoading),
		error: toolCall.error,
		payload: toolCall.result !== undefined ? extractJsonRenderPayload(toolCall.result) : null,
		args: toolCall.args,
	})),
);
</script>

<template>
	<div :class="$style.answerCards">
		<div v-for="card in cards" :key="card.id" :class="$style.card">
			<div v-if="card.loading" :class="$style.loading">
				<N8nSpinner size="small" />
				<N8nText size="small" color="text-light">{{
					i18n.baseText('instanceAi.jsonRender.renderingDashboard')
				}}</N8nText>
			</div>
			<N8nText v-else-if="card.error" size="small" color="danger">{{ card.error }}</N8nText>
			<JsonRenderToolResult
				v-else-if="card.payload"
				:payload="card.payload"
				:instance-id="`render-ui-answer-${card.id}`"
			/>
			<CollapsibleRoot v-if="card.args && !card.loading" v-slot="{ open: isOpen }">
				<CollapsibleTrigger :class="$style.argsToggle">
					{{
						isOpen
							? i18n.baseText('instanceAi.jsonRender.hideInput')
							: i18n.baseText('instanceAi.jsonRender.viewInput')
					}}
				</CollapsibleTrigger>
				<div v-if="isOpen" :class="$style.argsPanel">
					<ToolResultJson :value="card.args" />
				</div>
			</CollapsibleRoot>
		</div>
	</div>
</template>

<style lang="scss" module>
.answerCards {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--md);
	width: 100%;
}

.card {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--2xs);
	width: 100%;
}

.loading {
	display: flex;
	align-items: center;
	gap: var(--spacing--2xs);
}

.argsToggle {
	align-self: flex-start;
	border: none;
	background: transparent;
	color: var(--color--text--tint-1);
	font-size: var(--font-size--2xs);
	cursor: pointer;
	padding: 0;
}

.argsPanel {
	margin-top: var(--spacing--3xs);
}
</style>
