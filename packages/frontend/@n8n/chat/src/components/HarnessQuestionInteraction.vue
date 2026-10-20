<script setup lang="ts">
import { N8nButton, N8nCheckbox, N8nInput, N8nText } from '@n8n/design-system';
import { ElRadio } from 'element-plus';
import { computed, reactive } from 'vue';

interface HarnessQuestion {
	id: string;
	question: string;
	detail?: string;
	header?: string;
	options?: Array<{ label: string; description?: string }>;
	multiSelect?: boolean;
}

const props = defineProps<{
	payload: { type: 'harness-question'; questions: HarnessQuestion[] };
	disabled?: boolean;
}>();

const emit = defineEmits<{
	submit: [value: { answers: Array<{ id: string; selected: string[]; custom?: string }> }];
}>();

const selected = reactive<Record<string, string[]>>({});
const custom = reactive<Record<string, string>>({});

const canSubmit = computed(
	() =>
		!props.disabled &&
		props.payload.questions.every(
			(question) =>
				(selected[question.id]?.length ?? 0) > 0 || Boolean(custom[question.id]?.trim()),
		),
);

function setSingle(question: HarnessQuestion, value: string | number | boolean | undefined) {
	if (typeof value === 'string') selected[question.id] = [value];
}

function setMultiple(question: HarnessQuestion, label: string, checked: boolean) {
	const values = selected[question.id] ?? [];
	selected[question.id] = checked
		? [...values.filter((value) => value !== label), label]
		: values.filter((value) => value !== label);
}

function submit() {
	if (!canSubmit.value) return;
	emit('submit', {
		answers: props.payload.questions.map((question) => {
			const text = custom[question.id]?.trim();
			return {
				id: question.id,
				selected: selected[question.id] ?? [],
				...(text ? { custom: text } : {}),
			};
		}),
	});
}
</script>

<template>
	<form :class="$style.card" data-test-id="harness-question-card" @submit.prevent="submit">
		<fieldset
			v-for="question in payload.questions"
			:key="question.id"
			:class="$style.question"
			:disabled="disabled"
		>
			<N8nText v-if="question.header" tag="legend" bold>{{ question.header }}</N8nText>
			<N8nText>{{ question.question }}</N8nText>
			<N8nText v-if="question.detail" size="small" color="text-light">
				{{ question.detail }}
			</N8nText>

			<div v-if="question.options?.length" :class="$style.options">
				<template v-for="option in question.options" :key="option.label">
					<N8nCheckbox
						v-if="question.multiSelect"
						:model-value="selected[question.id]?.includes(option.label) ?? false"
						:disabled="disabled"
						@update:model-value="setMultiple(question, option.label, $event)"
					>
						<template #label>
							<span :class="$style.optionLabel">
								<N8nText>{{ option.label }}</N8nText>
								<N8nText v-if="option.description" size="xsmall" color="text-light">
									{{ option.description }}
								</N8nText>
							</span>
						</template>
					</N8nCheckbox>
					<ElRadio
						v-else
						:model-value="selected[question.id]?.[0] ?? ''"
						:label="option.label"
						:disabled="disabled"
						@update:model-value="setSingle(question, $event)"
					>
						<span :class="$style.optionLabel">
							<N8nText>{{ option.label }}</N8nText>
							<N8nText v-if="option.description" size="xsmall" color="text-light">
								{{ option.description }}
							</N8nText>
						</span>
					</ElRadio>
				</template>
			</div>

			<N8nInput
				:model-value="custom[question.id] ?? ''"
				:disabled="disabled"
				:placeholder="question.options?.length ? 'Other' : 'Enter your answer'"
				@update:model-value="custom[question.id] = String($event)"
			/>
		</fieldset>

		<N8nButton type="submit" size="small" :disabled="!canSubmit">Submit</N8nButton>
	</form>
</template>

<style lang="scss" module>
.card,
.question,
.options,
.optionLabel {
	display: flex;
	flex-direction: column;
}

.card {
	gap: var(--spacing--sm);
	padding: var(--spacing--sm);
	border: var(--border-width) var(--border-style) var(--border-color);
	border-radius: var(--radius--sm);
}

.question {
	gap: var(--spacing--3xs);
	min-width: 0;
	padding: 0;
	margin: 0;
	border: 0;
}

.options {
	gap: var(--spacing--5xs);
}

.optionLabel {
	gap: var(--spacing--5xs);
}
</style>
