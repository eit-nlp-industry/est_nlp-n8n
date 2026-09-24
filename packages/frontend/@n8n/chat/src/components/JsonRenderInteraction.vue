<script setup lang="ts">
import { elementPlusRegistry } from '@eit/json-render-element-plus';
import {
	JSON_RENDER_FORM_CANCEL_ACTION,
	JSON_RENDER_FORM_SUBMIT_ACTION,
	getValidInteractionFields,
	parseJsonRenderPayload,
	prepareJsonRenderInteractionPayload,
	validateInteractionFormValues,
	type JsonRenderEvent,
	type JsonRenderPayload,
} from '@eit/json-render-protocol';
import { JsonRenderPanel } from '@eit/json-render-vue';
import { computed, ref, watch } from 'vue';

import { useI18n } from '../composables/useI18n';

const { t } = useI18n();

const props = withDefaults(
	defineProps<{
		payload: JsonRenderPayload;
		instanceId: string;
		values?: Record<string, unknown>;
		readOnly?: boolean;
		status?: 'open' | 'submitted' | 'cancelled';
	}>(),
	{ readOnly: false, status: 'open' },
);

const emit = defineEmits<{
	submit: [value: Record<string, unknown>];
	cancel: [];
}>();

const handled = ref(false);
const parsed = computed(() => parseJsonRenderPayload(props.payload));
const fields = computed(() =>
	parsed.value.success ? getValidInteractionFields(parsed.value.data) : null,
);
const preparedPayload = computed(() =>
	parsed.value.success && fields.value
		? prepareJsonRenderInteractionPayload(parsed.value.data, {
				values: props.values,
				readOnly: props.readOnly,
			})
		: undefined,
);

watch(
	() => props.instanceId,
	() => {
		handled.value = false;
	},
);

function onJsonRenderEvent(event: JsonRenderEvent) {
	if (props.readOnly || handled.value) return;
	if (event.event.name === JSON_RENDER_FORM_SUBMIT_ACTION) {
		const form = validateInteractionFormValues(fields.value ?? [], event.payload?.form);
		if (!fields.value || !form) return;
		handled.value = true;
		emit('submit', form);
	} else if (event.event.name === JSON_RENDER_FORM_CANCEL_ACTION) {
		handled.value = true;
		emit('cancel');
	}
}
</script>

<template>
	<div class="json-render-interaction" :data-status="status">
		<JsonRenderPanel
			v-if="preparedPayload"
			:payload="preparedPayload"
			:instance-id="instanceId"
			:registry="elementPlusRegistry"
			:on-json-render-event="onJsonRenderEvent"
		/>
		<div v-else class="json-render-interaction__error" role="alert">
			{{ t('jsonRenderInvalidPayload') }}
		</div>
		<div v-if="status !== 'open'" class="json-render-interaction__status">
			{{ status === 'submitted' ? t('jsonRenderSubmitted') : t('jsonRenderCancelled') }}
		</div>
	</div>
</template>

<style scoped>
/*
 * Host chrome for interaction forms. eit-json-render ships no theme CSS —
 * Element Plus is a peer dep — so the chat/editor host owns readable form
 * chrome the same way MessageJsonRender owns dashboard chrome.
 */
.json-render-interaction {
	width: 100%;
	max-width: 100%;
	color: var(--color--text, var(--el-text-color-primary, #1f2937));
}

.json-render-interaction__error {
	color: var(--color--danger, var(--el-color-danger, #f56c6c));
}

.json-render-interaction__status {
	margin-top: var(--spacing--2xs, 0.5rem);
	color: var(--color--text--shade-1, var(--el-text-color-secondary, #6b7280));
	font-size: var(--font-size--xs, 0.75rem);
}

.json-render-interaction :deep(.json-render-panel) {
	width: 100%;
}

.json-render-interaction :deep(.json-render-card) {
	border: 1px solid var(--color--foreground, var(--el-border-color, #dcdfe6));
	border-radius: var(--radius--lg, var(--el-border-radius-base, 8px));
	background: var(--background--surface, var(--el-bg-color, #fff));
	overflow: visible;
	box-shadow: var(--shadow--light, none);
}

.json-render-interaction :deep(.el-card__header) {
	padding: var(--spacing--sm, 12px) var(--spacing--md, 16px);
	border-bottom: 1px solid var(--color--foreground, var(--el-border-color-lighter, #ebeef5));
	font-size: var(--font-size--sm, 0.875rem);
	font-weight: var(--font-weight--bold, 600);
	color: var(--color--text, var(--el-text-color-primary, #1f2937));
}

.json-render-interaction :deep(.el-card__body) {
	padding: var(--spacing--md, 16px);
	display: flex;
	flex-direction: column;
	gap: var(--spacing--md, 16px);
}

.json-render-interaction :deep(.json-render-form) {
	width: 100%;
	margin: 0;
}

.json-render-interaction :deep(.el-form-item) {
	margin-bottom: var(--spacing--md, 16px);
}

.json-render-interaction :deep(.el-form-item:last-child) {
	margin-bottom: 0;
}

.json-render-interaction :deep(.el-form-item__label) {
	margin-bottom: var(--spacing--3xs, 4px);
	color: var(--color--text--shade-1, var(--el-text-color-regular, #606266));
	font-size: var(--font-size--xs, 0.75rem);
	line-height: var(--line-height--md, 1.4);
	padding: 0;
}

.json-render-interaction :deep(.el-select),
.json-render-interaction :deep(.el-input),
.json-render-interaction :deep(.el-input-number),
.json-render-interaction :deep(.el-date-editor) {
	width: 100%;
}

.json-render-interaction :deep(.el-select .el-select__wrapper),
.json-render-interaction :deep(.el-input__wrapper) {
	min-height: 2rem;
	border-radius: var(--radius, var(--el-border-radius-base, 4px));
	box-shadow: 0 0 0 1px var(--color--foreground, var(--el-border-color, #dcdfe6)) inset;
	background: var(--background--surface, var(--el-fill-color-blank, #fff));
}

.json-render-interaction :deep(.el-select .el-select__wrapper:hover),
.json-render-interaction :deep(.el-input__wrapper:hover) {
	box-shadow: 0 0 0 1px var(--color--foreground--shade-1, var(--el-border-color-hover, #c0c4cc))
		inset;
}

.json-render-interaction :deep(.el-select .el-select__wrapper.is-focused),
.json-render-interaction :deep(.el-input__wrapper.is-focus) {
	box-shadow: 0 0 0 1px var(--color--primary, var(--el-color-primary, #409eff)) inset;
}

.json-render-interaction :deep(.el-select__selected-item),
.json-render-interaction :deep(.el-input__inner) {
	color: var(--color--text, var(--el-text-color-primary, #1f2937));
	font-size: var(--font-size--sm, 0.875rem);
}

.json-render-interaction :deep(.el-button) {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-height: 2rem;
	padding: 0 var(--spacing--sm, 12px);
	border-radius: var(--radius, var(--el-border-radius-base, 4px));
	border: 1px solid var(--color--foreground, var(--el-border-color, #dcdfe6));
	background: var(--background--surface, var(--el-fill-color-blank, #fff));
	color: var(--color--text, var(--el-text-color-primary, #1f2937));
	font-size: var(--font-size--sm, 0.875rem);
	line-height: 1;
	cursor: pointer;
}

.json-render-interaction :deep(.el-button + .el-button) {
	margin-left: 0;
}

.json-render-interaction :deep(.el-button--primary) {
	border-color: var(--color--primary, var(--el-color-primary, #409eff));
	background: var(--color--primary, var(--el-color-primary, #409eff));
	color: var(--color--text--on-primary, #fff);
}

.json-render-interaction :deep(.el-button.is-disabled),
.json-render-interaction :deep(.el-button--primary.is-disabled) {
	opacity: 0.55;
	cursor: not-allowed;
}

.json-render-interaction[data-status='submitted'] :deep(.json-render-card),
.json-render-interaction[data-status='cancelled'] :deep(.json-render-card) {
	opacity: 0.92;
}
</style>
