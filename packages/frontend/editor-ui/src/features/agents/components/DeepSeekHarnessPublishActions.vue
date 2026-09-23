<script setup lang="ts">
import {
	N8nActionDropdown,
	N8nButton,
	N8nIconButton,
	type ActionDropdownItem,
} from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import type { DeepSeekHarnessAgentDto } from '@n8n/api-types';

const props = defineProps<{
	agent: DeepSeekHarnessAgentDto;
	onPublish: () => Promise<void>;
	onUnpublish: () => Promise<void>;
}>();

const i18n = useI18n();

const actions: Array<ActionDropdownItem<'publish' | 'unpublish'>> = [
	{
		id: 'publish',
		label: i18n.baseText('workflows.publish'),
	},
	{
		id: 'unpublish',
		label: i18n.baseText('workflows.unpublish'),
		divided: true,
		get disabled() {
			return !props.agent.published;
		},
	},
];

async function publish() {
	await props.onPublish();
}

async function unpublish() {
	await props.onUnpublish();
}

function onSelect(action: 'publish' | 'unpublish') {
	if (action === 'publish') void publish();
	if (action === 'unpublish') void unpublish();
}
</script>

<template>
	<div :class="$style.publishButtonWrapper" data-test-id="deepseek-harness-publish-actions">
		<div :class="$style.buttonGroup">
			<N8nButton
				:class="$style.groupButtonLeft"
				variant="ghost"
				data-test-id="deepseek-harness-publish-button"
				@click="publish"
			>
				<div :class="$style.flex">
					<span
						v-if="props.agent.published"
						data-test-id="deepseek-harness-published-indicator"
						:class="$style.indicatorDot"
					/>
					{{ props.agent.published ? i18n.baseText('generic.published') : i18n.baseText('workflows.publish') }}
				</div>
			</N8nButton>
			<N8nActionDropdown
				:items="actions"
				placement="bottom-end"
				data-test-id="deepseek-harness-publish-menu"
				@select="onSelect"
			>
				<template #activator>
					<N8nIconButton
						:class="$style.groupButtonRight"
						variant="ghost"
						icon="chevron-down"
						:aria-label="i18n.baseText('node.moreActions')"
						data-test-id="deepseek-harness-publish-menu-button"
					/>
				</template>
			</N8nActionDropdown>
		</div>
	</div>
</template>

<style lang="scss" module>
.publishButtonWrapper {
	position: relative;
	display: inline-flex;
}

.buttonGroup {
	display: inline-flex;
	border: var(--border);
	border-radius: var(--radius--3xs);
}

.groupButtonLeft,
.groupButtonLeft:disabled,
.groupButtonLeft:hover:disabled {
	border-top-right-radius: 0;
	border-bottom-right-radius: 0;
	border-right-color: transparent;
}

.groupButtonLeft:hover {
	border-right-color: inherit;
}

.groupButtonRight {
	border-top-left-radius: 0;
	border-bottom-left-radius: 0;
	border-left: var(--border);
}

.buttonGroup:has(.groupButtonLeft:not(:disabled):hover) .groupButtonRight {
	border-left-color: transparent;
}

.indicatorDot {
	height: var(--spacing--2xs);
	width: var(--spacing--2xs);
	border-radius: 50%;
	display: inline-block;
	margin-right: var(--spacing--2xs);
	background-color: var(--color--mint-600);
}

.flex {
	display: flex;
	align-items: center;
}
</style>
