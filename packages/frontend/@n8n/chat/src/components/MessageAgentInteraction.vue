<script setup lang="ts">
import { N8nButton, N8nOption, N8nSelect, N8nText } from '@n8n/design-system';
import { ElRadio } from 'element-plus';
import { computed, ref } from 'vue';

import { useChat } from '@n8n/chat/composables';

interface CardButton {
	type?: 'button';
	label?: string;
	text?: string;
	value: string;
	style?: 'primary' | 'danger' | 'default';
}

interface CardOption {
	label: string;
	value: string;
	description?: string;
}

type CardComponent =
	| { type: 'section'; text: string; button?: CardButton }
	| {
			type: 'fields';
			fields?: Array<{ label: string; value: string }>;
			items?: Array<{ label: string; value: string }>;
	  }
	| { type: 'image'; url: string; alt?: string; altText?: string }
	| { type: 'divider' }
	| (CardButton & { type: 'button' })
	| {
			type: 'select' | 'radio_select';
			id?: string;
			label?: string;
			placeholder?: string;
			options: CardOption[];
	  };

interface InteractionPayload {
	text?: string;
	displayName?: string;
	toolName?: string;
	card?: {
		title?: string;
		message?: string;
		components?: CardComponent[];
	};
}

interface Interaction {
	messageId?: string;
	runId?: string;
	toolCallId?: string;
	interactionType?: 'approval' | 'chat_action';
	payload?: InteractionPayload;
}

type CardBlock =
	| { kind: 'buttons'; buttons: CardButton[] }
	| { kind: 'component'; component: Exclude<CardComponent, CardButton & { type: 'button' }> };

const props = defineProps<Interaction>();
const chat = useChat();
const submitted = ref(false);
const sending = ref(false);
const selectedOptions = ref<Record<string, string>>({});
const interactionDisabled = computed(
	() => sending.value || !chat.websocketReady.value || chat.ws?.readyState !== WebSocket.OPEN,
);

const card = computed(() => props.payload?.card);
const fallbackSummary = computed(() => {
	if (card.value?.title || card.value?.message) return undefined;
	return props.payload?.text?.trim() || undefined;
});

const blocks = computed<CardBlock[]>(() => {
	const result: CardBlock[] = [];
	for (const component of card.value?.components ?? []) {
		if (component.type === 'button') {
			const previous = result[result.length - 1];
			if (previous?.kind === 'buttons') previous.buttons.push(component);
			else result.push({ kind: 'buttons', buttons: [component] });
		} else {
			result.push({ kind: 'component', component });
		}
	}
	return result;
});

function buttonVariant(button: CardButton): 'solid' | 'destructive' | 'outline' {
	if (button.style === 'primary') return 'solid';
	if (button.style === 'danger') return 'destructive';
	return 'outline';
}

function optionKey(component: { id?: string }, index: number) {
	return component.id ?? String(index);
}

async function submit(resumeData: unknown): Promise<boolean> {
	if (submitted.value || interactionDisabled.value || !props.runId || !props.toolCallId)
		return false;
	const ws = chat.ws;
	if (ws?.readyState !== WebSocket.OPEN) return false;

	sending.value = true;
	try {
		ws.send(
			JSON.stringify({
				sessionId: chat.currentSessionId.value,
				action: 'sendMessage',
				chatInput: JSON.stringify({
					type: 'agent-suspension-response',
					runId: props.runId,
					toolCallId: props.toolCallId,
					resumeData,
				}),
			}),
		);
		chat.waitingForResponse.value = true;
		chat.blockUserInput.value = false;
		submitted.value = true;
		if (props.messageId) {
			const messageIndex = chat.messages.value.findIndex(
				(message) => message.id === props.messageId,
			);
			if (messageIndex !== -1) chat.messages.value.splice(messageIndex, 1);
		}
		return true;
	} catch {
		// Keep the interaction available so the user can retry.
		return false;
	} finally {
		sending.value = false;
	}
}

async function submitButton(button: CardButton) {
	await submit({ type: 'button', value: button.value });
}

async function submitOption(component: { id?: string }, index: number, value: string) {
	const didSubmit = await submit({
		type: 'select',
		...(component.id ? { id: component.id } : {}),
		value,
	});
	if (didSubmit) selectedOptions.value[optionKey(component, index)] = value;
}
</script>

<template>
	<div v-if="!submitted" :class="$style.card" data-test-id="agent-interaction-card">
		<N8nText v-if="card?.title" :class="$style.title" bold>{{ card.title }}</N8nText>
		<N8nText v-if="card?.message" :class="$style.message" color="text-base">
			{{ card.message }}
		</N8nText>
		<N8nText v-else-if="fallbackSummary" :class="$style.title" bold>
			{{ fallbackSummary }}
		</N8nText>

		<template v-for="(block, blockIndex) in blocks" :key="blockIndex">
			<div v-if="block.kind === 'buttons'" :class="$style.buttonRow">
				<N8nButton
					v-for="(button, buttonIndex) in block.buttons"
					:key="buttonIndex"
					size="small"
					:variant="buttonVariant(button)"
					:disabled="interactionDisabled"
					@click="submitButton(button)"
				>
					{{ button.label ?? button.text ?? button.value }}
				</N8nButton>
			</div>

			<template v-else>
				<div v-if="block.component.type === 'section'" :class="$style.section">
					<N8nText>{{ block.component.text }}</N8nText>
					<N8nButton
						v-if="block.component.button"
						:class="$style.sectionButton"
						size="small"
						:variant="buttonVariant(block.component.button)"
						:disabled="interactionDisabled"
						@click="submitButton(block.component.button)"
					>
						{{
							block.component.button.label ??
							block.component.button.text ??
							block.component.button.value
						}}
					</N8nButton>
				</div>

				<hr v-else-if="block.component.type === 'divider'" :class="$style.divider" />

				<div v-else-if="block.component.type === 'radio_select'" :class="$style.selectGroup">
					<N8nText v-if="block.component.label" :class="$style.selectLabel" bold>
						{{ block.component.label }}
					</N8nText>
					<ElRadio
						v-for="option in block.component.options"
						:key="option.value"
						:class="$style.radio"
						:model-value="selectedOptions[optionKey(block.component, blockIndex)] ?? ''"
						:label="option.value"
						:disabled="interactionDisabled"
						@update:model-value="submitOption(block.component, blockIndex, option.value)"
					>
						<span>{{ option.label }}</span>
						<N8nText v-if="option.description" size="xsmall" color="text-light">
							{{ option.description }}
						</N8nText>
					</ElRadio>
				</div>

				<div v-else-if="block.component.type === 'select'" :class="$style.selectGroup">
					<N8nText v-if="block.component.label" :class="$style.selectLabel" bold>
						{{ block.component.label }}
					</N8nText>
					<N8nSelect
						:model-value="selectedOptions[optionKey(block.component, blockIndex)]"
						size="small"
						:disabled="interactionDisabled"
						:placeholder="block.component.placeholder"
						@update:model-value="submitOption(block.component, blockIndex, $event)"
					>
						<N8nOption
							v-for="option in block.component.options"
							:key="option.value"
							:value="option.value"
							:label="option.label"
						/>
					</N8nSelect>
				</div>

				<div v-else-if="block.component.type === 'fields'" :class="$style.fieldsGroup">
					<div
						v-for="field in block.component.fields ?? block.component.items ?? []"
						:key="field.label"
						:class="$style.fieldRow"
					>
						<N8nText size="small" bold>{{ field.label }}</N8nText>
						<N8nText size="small">{{ field.value }}</N8nText>
					</div>
				</div>

				<img
					v-else-if="block.component.type === 'image'"
					:src="block.component.url"
					:alt="block.component.alt ?? block.component.altText ?? ''"
					:class="$style.image"
				/>
			</template>
		</template>

		<template v-if="interactionType === 'approval'">
			<N8nText :class="$style.muted" color="text-light">
				{{ payload?.displayName ?? payload?.toolName ?? 'The agent requested approval' }}
			</N8nText>
			<div :class="$style.buttonRow">
				<N8nButton size="small" :disabled="interactionDisabled" @click="submit({ approved: true })">
					Approve
				</N8nButton>
				<N8nButton
					size="small"
					variant="outline"
					:disabled="interactionDisabled"
					@click="submit({ approved: false })"
				>
					Reject
				</N8nButton>
			</div>
		</template>
	</div>
</template>

<style lang="scss" module>
.card {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--3xs);
	padding: var(--spacing--2xs);
	border: var(--border-width) var(--border-style) var(--border-color);
	border-radius: var(--radius--sm);
}

.title,
.message,
.section {
	margin-bottom: var(--spacing--4xs);
}

.section,
.selectGroup,
.fieldsGroup {
	display: flex;
	flex-direction: column;
}

.section {
	gap: var(--spacing--4xs);
}

.sectionButton,
.image {
	align-self: flex-start;
}

.divider {
	width: 100%;
	margin: var(--spacing--3xs) 0;
	border: none;
	border-top: var(--border-width) var(--border-style) var(--border-color);
}

.buttonRow {
	display: flex;
	flex-wrap: wrap;
	gap: var(--spacing--3xs);
}

.selectGroup,
.fieldsGroup {
	gap: var(--spacing--5xs);
}

.selectLabel {
	margin-bottom: var(--spacing--5xs);
}

.radio {
	margin-right: 0;
}

.fieldRow {
	display: flex;
	justify-content: space-between;
	gap: var(--spacing--2xs);
}

.image {
	max-width: 100%;
	height: auto;
	border-radius: var(--radius--sm);
}

.muted {
	opacity: 0.75;
}
</style>
