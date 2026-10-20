import { describe, expect, it } from 'vitest';

import {
	agentWorkflowInteractionSchema,
	agentWorkflowResumeMessageSchema,
} from '../workflow-suspension.schema';
import { chatHubMessageAgentInteractionSchema } from '../../chat-hub';

describe('agentWorkflowInteractionSchema', () => {
	it('parses an approval interaction', () => {
		const interaction = {
			runId: 'run-1',
			toolCallId: 'tool-call-1',
			interactionType: 'approval',
			payload: {
				type: 'approval',
				toolName: 'send_email',
				displayName: 'Send email',
				args: { to: 'person@example.com' },
			},
			blockUserInput: true,
		};

		expect(agentWorkflowInteractionSchema.parse(interaction)).toEqual(interaction);
	});

	it('parses a chat action with every supported rich-card component', () => {
		const interaction = {
			runId: 'run-2',
			toolCallId: 'tool-call-2',
			interactionType: 'chat_action',
			payload: {
				text: 'Choose how to continue',
				card: {
					awaitResponse: true,
					title: 'Review request',
					components: [
						{ type: 'section', text: 'Review the request' },
						{ type: 'fields', fields: [{ label: 'Status', value: 'Ready' }] },
						{ type: 'image', url: 'https://example.com/image.png', alt: 'Preview' },
						{ type: 'divider' },
						{ type: 'button', label: 'Approve', value: 'approve', style: 'primary' },
						{
							type: 'select',
							id: 'owner',
							options: [{ label: 'Alex', value: 'alex' }],
						},
						{
							type: 'radio_select',
							id: 'priority',
							options: [{ label: 'High', value: 'high' }],
						},
					],
				},
			},
			blockUserInput: true,
		};

		expect(agentWorkflowInteractionSchema.parse(interaction)).toEqual(interaction);
	});

	it('parses a json-render interaction', () => {
		const interaction = {
			runId: 'run-3',
			toolCallId: 'tool-call-3',
			interactionType: 'json_render',
			payload: {
				type: 'json-render-interaction',
				jsonRender: {
					format: 'json-render-v1',
					spec: { root: 'form', elements: { form: { type: 'form' } } },
				},
				message: 'Choose a refund reason',
			},
			blockUserInput: true,
		};

		expect(agentWorkflowInteractionSchema.parse(interaction)).toEqual(interaction);
	});

	it('parses a Harness question interaction with every input mode', () => {
		const interaction = {
			runId: 'event-1',
			toolCallId: 'call-1',
			interactionType: 'harness_question',
			payload: {
				type: 'harness-question',
				questions: [
					{
						id: 'environment',
						header: 'Environment',
						question: 'Which environment should receive the change?',
						detail: 'Production changes require an approval.',
						options: [
							{ label: 'Staging', description: 'Deploy to the staging environment.' },
							{ label: 'Production' },
						],
					},
					{
						id: 'checks',
						question: 'Which checks should run?',
						options: [{ label: 'Unit tests' }, { label: 'Type checks' }],
						multiSelect: true,
					},
					{
						id: 'notes',
						question: 'Add release notes.',
					},
				],
			},
			blockUserInput: true,
		};

		expect(agentWorkflowInteractionSchema.parse(interaction)).toEqual(interaction);
	});

	it('rejects a Harness interaction without questions', () => {
		expect(
			agentWorkflowInteractionSchema.safeParse({
				runId: 'event-1',
				toolCallId: 'call-1',
				interactionType: 'harness_question',
				payload: { type: 'harness-question', questions: [] },
				blockUserInput: true,
			}).success,
		).toBe(false);
	});

	it('rejects an unknown interaction type', () => {
		expect(
			agentWorkflowInteractionSchema.safeParse({
				runId: 'run-3',
				toolCallId: 'tool-call-3',
				interactionType: 'custom_form',
				payload: {},
				blockUserInput: true,
			}).success,
		).toBe(false);
	});

	it('rejects a chat action without a response card', () => {
		expect(
			agentWorkflowInteractionSchema.safeParse({
				runId: 'run-4',
				toolCallId: 'tool-call-4',
				interactionType: 'chat_action',
				payload: { text: 'This cannot resume an agent' },
				blockUserInput: true,
			}).success,
		).toBe(false);
	});
});

describe('agentWorkflowResumeMessageSchema', () => {
	it('preserves arbitrary resume data for runtime validation', () => {
		const message = {
			type: 'agent-suspension-response',
			runId: 'run-1',
			toolCallId: 'tool-call-1',
			resumeData: { nested: { answer: ['one', 2, true] } },
		};

		expect(agentWorkflowResumeMessageSchema.parse(message)).toEqual(message);
	});

	it('preserves a Harness answer batch', () => {
		const message = {
			type: 'agent-suspension-response',
			runId: 'event-1',
			toolCallId: 'call-1',
			resumeData: {
				answers: [
					{ id: 'environment', selected: ['Staging'] },
					{ id: 'checks', selected: ['Unit tests', 'Type checks'] },
					{ id: 'notes', selected: [], custom: 'Ship after validation.' },
				],
			},
		};

		expect(agentWorkflowResumeMessageSchema.parse(message)).toEqual(message);
	});
});

describe('chatHubMessageAgentInteractionSchema', () => {
	it('wraps a native agent interaction for the editor chat surface', () => {
		const message = {
			type: 'agent-interaction',
			interaction: {
				runId: 'run-1',
				toolCallId: 'tool-call-1',
				interactionType: 'approval',
				payload: { type: 'approval', toolName: 'send_email', args: {} },
				blockUserInput: true,
			},
		};

		expect(chatHubMessageAgentInteractionSchema.parse(message)).toEqual(message);
	});
});
