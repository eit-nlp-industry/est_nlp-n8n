import { N8nButton, N8nSelect } from '@n8n/design-system';
import { ElRadio } from 'element-plus';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import MessageAgentInteraction from '../components/MessageAgentInteraction.vue';
import JsonRenderInteraction from '../components/JsonRenderInteraction.vue';
import { MessageComponentKey } from '../constants/messageComponents';
import { ChatSymbol } from '../constants/symbols';
import type { ChatMessage } from '../types';

type InteractionProps = InstanceType<typeof MessageAgentInteraction>['$props'];
type InteractionCard = NonNullable<NonNullable<InteractionProps['payload']>['card']>;
type InteractionComponent = NonNullable<InteractionCard['components']>[number];

function mountInteraction(
	components: InteractionComponent[],
	card: Omit<InteractionCard, 'components'> = {},
	ws: Pick<WebSocket, 'readyState' | 'send'> | null = {
		readyState: WebSocket.OPEN,
		send: vi.fn(),
	},
) {
	const sendMessage = vi.fn().mockResolvedValue(null);
	const messages = ref<ChatMessage[]>([
		{
			id: 'interaction-message-1',
			sender: 'bot',
			type: 'component',
			key: MessageComponentKey.AGENT_INTERACTION,
			arguments: {},
		},
	]);
	const wrapper = mount(MessageAgentInteraction, {
		props: {
			messageId: 'interaction-message-1',
			runId: 'run-1',
			toolCallId: 'tool-call-1',
			interactionType: 'chat_action',
			payload: {
				card: { ...card, components },
			},
		},
		global: {
			provide: {
				[ChatSymbol as symbol]: {
					sendMessage,
					messages,
					currentSessionId: ref('session-1'),
					waitingForResponse: ref(false),
					blockUserInput: ref(true),
					websocketReady: ref(ws?.readyState === WebSocket.OPEN),
					ws,
				},
			},
		},
	});

	return { wrapper, sendMessage, messages, ws };
}

describe('MessageAgentInteraction', () => {
	it('renders radio choices and submits the selected option', async () => {
		const { wrapper, sendMessage, ws } = mountInteraction([
			{
				type: 'radio_select',
				id: 'refund_reason',
				label: 'Refund reason',
				options: [
					{ label: 'Wrong purchase', value: 'wrong_purchase' },
					{ label: 'Duplicate charge', value: 'duplicate_charge' },
				],
			},
		]);

		const radios = wrapper.findAllComponents(ElRadio);
		expect(radios).toHaveLength(2);

		radios[1].vm.$emit('update:modelValue', 'duplicate_charge');
		await flushPromises();

		expect(wrapper.find('[data-test-id="agent-interaction-card"]').exists()).toBe(false);
		expect(ws?.send).toHaveBeenCalledWith(
			JSON.stringify({
				sessionId: 'session-1',
				action: 'sendMessage',
				chatInput: JSON.stringify({
					type: 'agent-suspension-response',
					runId: 'run-1',
					toolCallId: 'tool-call-1',
					resumeData: {
						type: 'select',
						id: 'refund_reason',
						value: 'duplicate_charge',
					},
				}),
			}),
		);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it('renders a select and submits the selected option', async () => {
		const { wrapper, ws } = mountInteraction([
			{
				type: 'select',
				id: 'refund_reason',
				label: 'Refund reason',
				options: [{ label: 'Wrong purchase', value: 'wrong_purchase' }],
			},
		]);

		const select = wrapper.findComponent(N8nSelect);
		expect(select.exists()).toBe(true);

		select.vm.$emit('update:modelValue', 'wrong_purchase');
		await flushPromises();

		expect(ws?.send).toHaveBeenCalledWith(
			JSON.stringify({
				sessionId: 'session-1',
				action: 'sendMessage',
				chatInput: JSON.stringify({
					type: 'agent-suspension-response',
					runId: 'run-1',
					toolCallId: 'tool-call-1',
					resumeData: {
						type: 'select',
						id: 'refund_reason',
						value: 'wrong_purchase',
					},
				}),
			}),
		);
	});

	it('submits a typed button response and removes the card', async () => {
		const { wrapper, messages, ws } = mountInteraction(
			[{ type: 'button', label: 'Continue', value: 'continue', style: 'primary' }],
			{ title: 'Refund request', message: 'Select the next step.' },
		);

		expect(wrapper.text()).toContain('Refund request');
		expect(wrapper.text()).toContain('Select the next step.');

		const button = wrapper.findComponent(N8nButton);
		await button.trigger('click');
		await flushPromises();

		expect(ws?.send).toHaveBeenCalledWith(
			JSON.stringify({
				sessionId: 'session-1',
				action: 'sendMessage',
				chatInput: JSON.stringify({
					type: 'agent-suspension-response',
					runId: 'run-1',
					toolCallId: 'tool-call-1',
					resumeData: { type: 'button', value: 'continue' },
				}),
			}),
		);
		expect(wrapper.find('[data-test-id="agent-interaction-card"]').exists()).toBe(false);
		expect(messages.value).toHaveLength(0);
	});

	it('disables controls while the execution socket is unavailable', async () => {
		const { wrapper, sendMessage } = mountInteraction(
			[{ type: 'button', label: 'Continue', value: 'continue' }],
			{},
			null,
		);

		const button = wrapper.findComponent(N8nButton);
		expect(button.props('disabled')).toBe(true);
		await button.trigger('click');
		await flushPromises();

		expect(wrapper.find('[data-test-id="agent-interaction-card"]').exists()).toBe(true);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it('does not commit a radio selection while the socket is unavailable', async () => {
		const { wrapper } = mountInteraction(
			[
				{
					type: 'radio_select',
					id: 'refund_reason',
					options: [{ label: 'Wrong purchase', value: 'wrong_purchase' }],
				},
			],
			{},
			null,
		);
		const radio = wrapper.findComponent(ElRadio);

		radio.vm.$emit('update:modelValue', 'wrong_purchase');
		await flushPromises();

		expect(radio.props('modelValue')).toBe('');
		expect(wrapper.find('[data-test-id="agent-interaction-card"]').exists()).toBe(true);
	});

	it('keeps the card available when WebSocket.send throws', async () => {
		const ws = {
			readyState: WebSocket.OPEN,
			send: vi.fn(() => {
				throw new Error('send failed');
			}),
		};
		const { wrapper } = mountInteraction(
			[{ type: 'button', label: 'Continue', value: 'continue' }],
			{},
			ws,
		);

		await wrapper.findComponent(N8nButton).trigger('click');
		await flushPromises();

		expect(wrapper.find('[data-test-id="agent-interaction-card"]').exists()).toBe(true);
		expect(wrapper.findComponent(N8nButton).props('disabled')).toBe(false);
	});

	it('renders field values', () => {
		const { wrapper } = mountInteraction([
			{
				type: 'fields',
				fields: [{ label: 'Order', value: 'A100' }],
			},
		]);

		expect(wrapper.text()).toContain('Order');
		expect(wrapper.text()).toContain('A100');
	});

	it('renders json-render and submits its decision as an agent suspension response', async () => {
		const { wrapper, ws } = mountInteraction([]);
		await wrapper.setProps({
			interactionType: 'json_render' as never,
			payload: {
				type: 'json-render-interaction',
				jsonRender: {
					format: 'json-render-v1',
					spec: { root: 'form', elements: { form: { type: 'form' } } },
				},
			} as never,
		});

		const jsonRender = wrapper.findComponent(JsonRenderInteraction);
		expect(jsonRender.exists()).toBe(true);

		jsonRender.vm.$emit('submit', { refundReason: 'wrong_purchase' });
		await flushPromises();

		expect(ws?.send).toHaveBeenCalledWith(
			JSON.stringify({
				sessionId: 'session-1',
				action: 'sendMessage',
				chatInput: JSON.stringify({
					type: 'agent-suspension-response',
					runId: 'run-1',
					toolCallId: 'tool-call-1',
					resumeData: {
						approved: true,
						value: { refundReason: 'wrong_purchase' },
					},
				}),
			}),
		);
	});
});
