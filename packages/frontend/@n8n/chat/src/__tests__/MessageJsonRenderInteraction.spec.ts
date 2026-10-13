import {
	appendDynamicFormToSpec,
	appendStepsToSpec,
	type JsonRenderPayload,
} from '@eit/json-render-protocol';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { ref } from 'vue';

import JsonRenderInteraction from '../components/JsonRenderInteraction.vue';
import MessageJsonRenderInteraction from '../components/MessageJsonRenderInteraction.vue';
import { ChatSymbol } from '../constants/symbols';

vi.mock('../composables/useI18n', () => ({
	useI18n: () => ({ t: (key: string) => key }),
}));

const payload: JsonRenderPayload = {
	format: 'json-render-v1',
	spec: appendDynamicFormToSpec(
		appendStepsToSpec(
			{ root: 'root', elements: { root: { type: 'Card', children: [] } } },
			{ active: 1, items: [{ title: 'Prepare' }, { title: 'Approve' }] },
		),
		[{ type: 'input', key: 'name', label: 'Name', value: 'Ada' }],
	),
};

describe('MessageJsonRenderInteraction', () => {
	it.each([
		{ approved: true, status: 'submitted', value: { name: 'Lin' } },
		{ approved: false, status: 'cancelled', value: undefined },
	])('keeps the Steps payload in resolved $status history', ({ approved, status, value }) => {
		const wrapper = shallowMount(MessageJsonRenderInteraction, {
			props: { payload, resolved: { approved, value } },
			global: {
				provide: {
					[ChatSymbol as symbol]: {
						messages: ref([]),
						currentSessionId: ref('session'),
						waitingForResponse: ref(false),
						blockUserInput: ref(false),
					},
				},
			},
		});
		const interaction = wrapper.findComponent(JsonRenderInteraction);

		expect(interaction.props('payload').spec.elements.steps).toMatchObject({ type: 'Steps' });
		expect(interaction.props()).toMatchObject({ readOnly: true, status, values: value });
	});

	it('offers an explicit retry after an HTTP failure without duplicating the decision bubble', async () => {
		const sendMessage = vi
			.fn()
			.mockRejectedValueOnce(new Error('Network error'))
			.mockResolvedValueOnce(null);
		const messages = ref<Array<{ id: string; sender: 'user'; text: string }>>([]);
		const wrapper = shallowMount(MessageJsonRenderInteraction, {
			props: { payload },
			global: {
				provide: {
					[ChatSymbol as symbol]: {
						messages,
						sendMessage,
						currentSessionId: ref('session'),
						waitingForResponse: ref(false),
						blockUserInput: ref(true),
					},
				},
			},
		});

		wrapper.findComponent(JsonRenderInteraction).vm.$emit('submit', { name: 'Grace' });
		await flushPromises();

		expect(wrapper.find('[data-test-id="retry-interaction"]').exists()).toBe(true);
		expect(messages.value).toHaveLength(1);
		expect(sendMessage).toHaveBeenCalledWith(
			JSON.stringify({
				type: 'json-render-interaction-response',
				approved: true,
				value: { name: 'Grace' },
			}),
			[],
			{ addToTranscript: false, throwOnError: true },
		);

		await wrapper.find('[data-test-id="retry-interaction"]').trigger('click');
		await flushPromises();

		expect(sendMessage).toHaveBeenCalledTimes(2);
		expect(messages.value).toHaveLength(1);
		expect(wrapper.find('[data-test-id="retry-interaction"]').exists()).toBe(false);
	});
});
