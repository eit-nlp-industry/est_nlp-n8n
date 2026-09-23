import type { JsonRenderPayload } from '@eit/json-render-protocol';
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
	spec: { root: 'root', elements: { root: { type: 'Card', children: [] } } },
};

describe('MessageJsonRenderInteraction', () => {
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
