<script setup lang="ts">
import type { AgentWorkflowInteraction, ChatMessageContentChunk } from '@n8n/api-types';
import type { ApprovalInput } from '@/features/ai/shared/agentsChat/types';
import type {
	N8nChatInteractionInput,
	N8nChatResumeValue,
} from '@/features/ai/shared/agentsChat/n8nChatInteraction';
import type { ApprovalResume } from '@/features/ai/shared/agentsChat/types';
import ApprovalCard from '@/features/agents/components/interactive/ApprovalCard.vue';
import N8nChatActionCard from '@/features/agents/components/interactive/N8nChatActionCard.vue';

const props = defineProps<{
	source: Extract<ChatMessageContentChunk, { type: 'agent-interaction' }>;
	disabled?: boolean;
	resolvedValue?: unknown;
}>();

const emit = defineEmits<{ submit: [resumeData: unknown] }>();

const interaction = props.source.interaction as AgentWorkflowInteraction;
const approvalInput = interaction.payload as unknown as ApprovalInput;
const actionInput = interaction.payload as unknown as N8nChatInteractionInput;
const approvalResolved = props.resolvedValue as ApprovalResume | undefined;
const actionResolved = props.resolvedValue as N8nChatResumeValue | undefined;
</script>

<template>
	<ApprovalCard
		v-if="interaction.interactionType === 'approval'"
		:input="approvalInput"
		:disabled="disabled"
		:resolved-value="approvalResolved"
		@submit="emit('submit', $event)"
	/>
	<N8nChatActionCard
		v-else
		:input="actionInput"
		:disabled="disabled"
		:resolved-value="actionResolved"
		@submit="emit('submit', $event)"
	/>
</template>
