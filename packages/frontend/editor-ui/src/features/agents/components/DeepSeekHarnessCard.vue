<script setup lang="ts">
import dateformat from 'dateformat';
import { N8nActionToggle, N8nCard, N8nText } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';

import TimeAgo from '@/app/components/TimeAgo.vue';
import type { DeepSeekHarnessResource } from '../types';

defineProps<{
	agent: DeepSeekHarnessResource;
}>();

const locale = useI18n();

const emit = defineEmits<{
	delete: [agentId: string];
	open: [agentId: string];
}>();

const actions = [
	{
		value: 'delete',
		label: locale.baseText('deepseekHarness.actions.delete'),
	},
];

const formatCreatedAt = (value: string | Date) => {
	const date = new Date(value);
	const currentYear = new Date().getFullYear().toString();
	return dateformat(date, `d mmmm${date.getFullYear().toString() === currentYear ? '' : ', yyyy'}`);
};
</script>

<template>
	<N8nCard
		:class="$style.card"
		data-test-id="deepseek-harness-card"
		@click="emit('open', agent.id)"
	>
		<template #header>
			<N8nText tag="h2" bold :class="$style.cardHeading" data-test-id="deepseek-harness-card-name">
				{{ agent.name }}
			</N8nText>
		</template>

		<div :class="$style.cardDescription">
			<span>
				{{ locale.baseText('agents.list.updated') }}
				<TimeAgo :date="String(agent.updatedAt)" /> |
			</span>
			<span>
				{{ locale.baseText('agents.list.created') }}
				{{ formatCreatedAt(agent.createdAt) }}
			</span>
		</div>

		<template #append>
			<div :class="$style.cardActions" @click.stop>
				<N8nActionToggle
					:actions="actions"
					theme="dark"
					data-test-id="deepseek-harness-card-actions"
					@action="(action) => action === 'delete' && emit('delete', agent.id)"
				/>
			</div>
		</template>
	</N8nCard>
</template>

<style lang="scss" module>
.card {
	margin-bottom: var(--spacing--2xs);
	padding: 0;
	align-items: stretch;
}

.cardHeading {
	display: flex;
	align-items: center;
	font-size: var(--font-size--sm);
	word-break: break-word;
	padding: var(--spacing--sm) 0 0 var(--spacing--sm);
}

.cardDescription {
	min-height: var(--spacing--xl);
	display: flex;
	align-items: center;
	padding: 0 0 var(--spacing--sm) var(--spacing--sm);
	font-size: var(--font-size--2xs);
	color: var(--color--text--tint-1);
	gap: var(--spacing--2xs);
}

.cardActions {
	display: flex;
	gap: var(--spacing--4xs);
	align-items: center;
	padding-right: var(--spacing--sm);
}
</style>
