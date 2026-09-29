<script setup lang="ts">
import {
	buildRenderInteractionEditorText,
	formatRenderInteractionConfig,
	nodeParametersToRenderInteractionConfig,
	parseRenderInteractionConfigText,
	renderInteractionConfigToNodeParameters,
} from '@n8n/api-types';
import { useClipboard } from '@n8n/composables/useClipboard';
import {
	N8nButton,
	N8nDialog,
	N8nDialogDescription,
	N8nDialogFooter,
	N8nDialogHeader,
	N8nDialogTitle,
	N8nText,
} from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import type { INodeParameters } from 'n8n-workflow';
import { computed, ref, watch } from 'vue';

import JsonEditor from '@/features/shared/editors/components/JsonEditor/JsonEditor.vue';

const props = defineProps<{
	parameters: INodeParameters;
}>();

const emit = defineEmits<{
	apply: [parameters: INodeParameters];
}>();

const i18n = useI18n();
const clipboard = useClipboard();

const isDialogOpen = ref(false);
const editorText = ref('');
const validationError = ref('');
const copyNotice = ref(false);

const canCopyCurrentConfig = computed(
	() => nodeParametersToRenderInteractionConfig(props.parameters) !== null,
);

watch(
	() => props.parameters,
	() => {
		if (!isDialogOpen.value) {
			validationError.value = '';
		}
	},
	{ deep: true },
);

function openDialog() {
	editorText.value = buildRenderInteractionEditorText(props.parameters);
	validationError.value = '';
	copyNotice.value = false;
	isDialogOpen.value = true;
}

function closeDialog() {
	isDialogOpen.value = false;
	validationError.value = '';
	copyNotice.value = false;
}

async function copyJsonToClipboard() {
	const text =
		nodeParametersToRenderInteractionConfig(props.parameters) !== null
			? buildRenderInteractionEditorText(props.parameters)
			: editorText.value;
	await clipboard.copy(text.trimEnd());
	copyNotice.value = true;
}

function applyJson() {
	const parsed = parseRenderInteractionConfigText(editorText.value);
	if (!parsed.ok) {
		validationError.value = parsed.error;
		return;
	}

	emit('apply', renderInteractionConfigToNodeParameters(parsed.config, props.parameters));
	closeDialog();
}

function insertMinimalTemplate() {
	editorText.value = formatRenderInteractionConfig({
		title: 'Interaction title',
		description: '',
		metrics: [],
		tableColumns: [],
		tableRows: [],
		fields: [
			{
				key: 'action',
				label: 'Action',
				type: 'select',
				options: [{ value: 'confirm', label: 'Confirm' }],
				optionsJson: [],
				defaultValue: '',
			},
		],
	});
	validationError.value = '';
}
</script>

<template>
	<div :class="$style.root" data-test-id="render-interaction-config-json-panel">
		<N8nText size="small" color="text-light">
			{{ i18n.baseText('renderInteraction.configJson.hint') }}
		</N8nText>
		<N8nText v-if="copyNotice && !isDialogOpen" size="small" color="text-light">
			{{ i18n.baseText('renderInteraction.configJson.copied') }}
		</N8nText>
		<div :class="$style.actions">
			<N8nButton
				size="small"
				variant="subtle"
				data-test-id="render-interaction-edit-json"
				@click="openDialog"
			>
				{{ i18n.baseText('renderInteraction.configJson.editButton') }}
			</N8nButton>
			<N8nButton
				size="small"
				variant="subtle"
				data-test-id="render-interaction-copy-json"
				:disabled="!canCopyCurrentConfig"
				@click="copyJsonToClipboard"
			>
				{{ i18n.baseText('renderInteraction.configJson.copyButton') }}
			</N8nButton>
		</div>

		<N8nDialog :open="isDialogOpen" size="large" @update:open="(open) => !open && closeDialog()">
			<div :class="$style.dialogBody" data-test-id="render-interaction-json-dialog">
				<N8nDialogHeader>
					<N8nDialogTitle>
						{{ i18n.baseText('renderInteraction.configJson.dialogTitle') }}
					</N8nDialogTitle>
					<N8nDialogDescription>
						{{ i18n.baseText('renderInteraction.configJson.dialogDescription') }}
					</N8nDialogDescription>
				</N8nDialogHeader>

				<div :class="$style.editorHost">
					<JsonEditor v-model="editorText" :rows="18" fill-parent />
				</div>

				<N8nText v-if="validationError" size="small" color="danger" role="alert">
					{{ validationError }}
				</N8nText>
				<N8nText v-else-if="copyNotice" size="small" color="text-light">
					{{ i18n.baseText('renderInteraction.configJson.copied') }}
				</N8nText>

				<N8nDialogFooter>
					<N8nButton variant="subtle" @click="insertMinimalTemplate">
						{{ i18n.baseText('renderInteraction.configJson.insertTemplate') }}
					</N8nButton>
					<N8nButton
						variant="subtle"
						data-test-id="render-interaction-json-cancel"
						@click="closeDialog"
					>
						{{ i18n.baseText('generic.cancel') }}
					</N8nButton>
					<N8nButton
						variant="solid"
						data-test-id="render-interaction-json-apply"
						@click="applyJson"
					>
						{{ i18n.baseText('renderInteraction.configJson.applyButton') }}
					</N8nButton>
				</N8nDialogFooter>
			</div>
		</N8nDialog>
	</div>
</template>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--2xs);
	flex-shrink: 0;
	margin-bottom: var(--spacing--sm);
	padding: var(--spacing--sm);
	border: var(--border-width) solid var(--color--foreground);
	border-radius: var(--radius--lg);
	background: var(--color--background--light-2);
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--spacing--2xs);
}

.dialogBody {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--sm);
	height: calc(100dvh - var(--spacing--4xl));
	min-height: 0;
	overflow: hidden;
}

.editorHost {
	flex: 1;
	min-height: 0;
	overflow: hidden;
}
</style>
