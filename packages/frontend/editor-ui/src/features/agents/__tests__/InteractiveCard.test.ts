/* eslint-disable import-x/no-extraneous-dependencies -- test-only */
import { mount } from '@vue/test-utils';
import {
	APPROVAL_TOOL_NAME,
	JSON_RENDER_INTERACTION_TOOL_NAME,
	WAIT_TOOL_NAME,
} from '@n8n/api-types';
import { describe, expect, it, vi } from 'vitest';

import InteractiveCard from '../components/interactive/InteractiveCard.vue';
import type { InteractivePayload } from '@/features/ai/shared/agentsChat/types';

vi.mock('@n8n/i18n', () => {
	const i18n = {
		baseText: (key: string, options?: { interpolate?: Record<string, string> }) => {
			if (key === 'agents.chat.approval.title') return 'Approval required';
			if (key === 'agents.chat.approval.description') {
				return `The agent wants to run the ${options?.interpolate?.toolName ?? ''} tool.`;
			}
			if (key === 'agents.chat.approval.approve') return 'Approve';
			if (key === 'agents.chat.approval.reject') return 'Reject';
			if (key === 'agents.chat.approval.approved') return 'Approved';
			if (key === 'agents.chat.approval.rejected') return 'Rejected';
			if (key === 'agents.chat.approval.viewToolDetails') return 'View tool details';
			if (key === 'generic.cancel') return 'Cancel';
			if (key === 'jsonRender.interaction.submit') return 'Submit';
			return key;
		},
	};
	return { useI18n: () => i18n, i18n, i18nInstance: { install: vi.fn() } };
});

vi.mock('@/features/ai/shared/JsonRenderInteractionPanel.vue', () => ({
	default: {
		name: 'JsonRenderInteractionPanel',
		props: ['payload', 'instanceId', 'introMessage', 'disabled', 'values', 'status'],
		emits: ['submit', 'cancel'],
		template: `
			<div>
				<button data-test-id="json-render-interaction-cancel" :disabled="disabled" @click="$emit('cancel')">Cancel</button>
				<button data-test-id="json-render-interaction-submit" :disabled="disabled" @click="$emit('submit', { next_action: 'go' })">Submit</button>
			</div>
		`,
	},
}));

function mountCard(payload: InteractivePayload) {
	return mount(InteractiveCard, {
		props: { payload },
		global: {
			stubs: {
				N8nCard: { template: '<section><slot /></section>' },
				N8nText: { template: '<span><slot /></span>', props: ['tag', 'bold', 'size', 'color'] },
				N8nIcon: { template: '<i />', props: ['icon', 'size', 'color'] },
				N8nButton: {
					template:
						'<button :disabled="disabled" :data-testid="$attrs[\'data-testid\']" @click="$emit(\'click\')"><slot /></button>',
					props: ['disabled', 'type', 'variant', 'size'],
					emits: ['click'],
				},
			},
		},
	});
}

const approvalPayload: InteractivePayload = {
	toolName: APPROVAL_TOOL_NAME,
	toolCallId: 'tc-approval',
	runId: 'run-approval',
	input: {
		type: 'approval',
		toolName: 'calculator',
		displayName: 'Calculator',
		args: { input: '2 + 2' },
		details: {
			toolName: 'calculator',
			input: { input: '2 + 2' },
			node: { parameters: { operation: 'calculate' } },
		},
	},
};

const jsonRenderForm = {
	format: 'json-render-v1' as const,
	spec: {
		root: 'root',
		elements: {
			root: { type: 'Card', children: ['form', 'submit', 'cancel'] },
			form: {
				type: 'DynamicForm',
				props: {
					fields: [
						{
							type: 'select',
							key: 'next_action',
							label: 'Next action',
							value: { options: [{ value: 'go', label: 'Go' }] },
						},
					],
				},
			},
			submit: {
				type: 'Button',
				props: { label: 'Submit' },
				on: { press: { action: 'form.submit' } },
			},
			cancel: {
				type: 'Button',
				props: { label: 'Cancel' },
				on: { press: { action: 'form.cancel' } },
			},
		},
	},
};

describe('InteractiveCard', () => {
	it('renders approval details and emits approved resume data', async () => {
		const wrapper = mountCard(approvalPayload);

		expect(wrapper.text()).toContain('Approval required');
		expect(wrapper.text()).toContain('The agent wants to run the Calculator tool.');
		expect(wrapper.text()).not.toContain('calculator.');
		expect(wrapper.text()).toContain('2 + 2');
		expect(wrapper.text()).toContain('operation');
		const details = wrapper.find('[data-testid="agent-approval-tool-details"]');
		expect(details.exists()).toBe(true);
		expect(details.attributes('open')).toBeUndefined();

		await wrapper.find('[data-testid="agent-approval-approve"]').trigger('click');

		expect(wrapper.emitted('submit')).toEqual([[{ approved: true }]]);
	});

	it('renders approval args as provided by the backend', () => {
		const wrapper = mountCard({
			...approvalPayload,
			input: {
				type: 'approval',
				toolName: 'calculator',
				displayName: 'Calculator',
				args: {
					query: 'project status',
					password: 'super-secret-password',
					nested: {
						apiKey: 'api-key-value',
						authorization: 'Bearer token-value',
					},
				},
			},
		});

		expect(wrapper.text()).toContain('project status');
		expect(wrapper.text()).toContain('super-secret-password');
		expect(wrapper.text()).toContain('api-key-value');
		expect(wrapper.text()).toContain('token-value');
	});

	it('emits rejected resume data from the reject action', async () => {
		const wrapper = mountCard(approvalPayload);

		await wrapper.find('[data-testid="agent-approval-reject"]').trigger('click');

		expect(wrapper.emitted('submit')).toEqual([[{ approved: false }]]);
	});

	it('renders resolved approval state without active actions', () => {
		const wrapper = mountCard({
			...approvalPayload,
			resolvedAt: 1,
			resolvedValue: { approved: false },
		});

		expect(wrapper.text()).toContain('Rejected');
		expect(wrapper.find('[data-testid="agent-approval-approve"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="agent-approval-reject"]').exists()).toBe(false);
	});
	// A workflow tool parked on a Wait node reuses the chat card renderer, and its
	// buttons resume the parked run with the value the backend declared.
	it('renders the waiting card and emits the clicked button as resume data', async () => {
		const wrapper = mountCard({
			toolName: WAIT_TOOL_NAME,
			toolCallId: 'tc-wait',
			runId: 'run-wait',
			input: {
				card: {
					title: 'Waiting on "Approval workflow"',
					components: [
						{ type: 'section', text: 'The "Approval workflow" workflow is paused.' },
						{ type: 'button', label: 'Check for the result', value: 'continue' },
						{ type: 'button', label: 'Stop waiting', value: 'cancel' },
					],
				},
			},
		});

		expect(wrapper.text()).toContain('Waiting on "Approval workflow"');
		const buttons = wrapper.findAll('[data-testid="n8n-chat-card-button"]');
		expect(buttons.map((button) => button.text())).toEqual([
			'Check for the result',
			'Stop waiting',
		]);

		await buttons[1].trigger('click');

		expect(wrapper.emitted('submit')).toEqual([[{ type: 'button', value: 'cancel' }]]);
	});

	it('renders the json-render form and emits the submitted values', async () => {
		const wrapper = mountCard({
			toolName: JSON_RENDER_INTERACTION_TOOL_NAME,
			toolCallId: 'tc-json-render',
			runId: 'run-json-render',
			input: {
				type: 'json-render-interaction',
				jsonRender: {
					format: 'json-render-v1',
					spec: jsonRenderForm.spec,
					meta: { title: 'Choose next' },
				},
				message: 'Choose the next action',
			},
		});

		expect(wrapper.find('[data-testid="agent-json-render-interaction-card"]').exists()).toBe(true);

		await wrapper.find('[data-test-id="json-render-interaction-submit"]').trigger('click');

		expect(wrapper.emitted('submit')).toEqual([[{ approved: true, value: { next_action: 'go' } }]]);
	});

	it('emits a cancelled resume when the json-render form is cancelled', async () => {
		const wrapper = mountCard({
			toolName: JSON_RENDER_INTERACTION_TOOL_NAME,
			toolCallId: 'tc-json-render',
			runId: 'run-json-render',
			input: {
				type: 'json-render-interaction',
				jsonRender: jsonRenderForm,
			},
		});

		await wrapper.find('[data-test-id="json-render-interaction-cancel"]').trigger('click');

		expect(wrapper.emitted('submit')).toEqual([[{ approved: false }]]);
	});

	it('renders a resolved json-render form as read-only with its submitted values', () => {
		const wrapper = mountCard({
			toolName: JSON_RENDER_INTERACTION_TOOL_NAME,
			toolCallId: 'tc-json-render-resolved',
			resolvedAt: 1,
			resolvedValue: { approved: true, value: { next_action: 'rest' } },
			input: {
				type: 'json-render-interaction',
				jsonRender: jsonRenderForm,
			},
		});

		const panel = wrapper.findComponent({ name: 'JsonRenderInteractionPanel' });
		expect(panel.props()).toMatchObject({
			instanceId: 'tc-json-render-resolved',
			disabled: true,
			values: { next_action: 'rest' },
			status: 'submitted',
		});
	});
});
