import { appendDynamicFormToSpec, type JsonRenderPayload } from '@eit/json-render-protocol';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

vi.mock('../composables/useI18n', () => ({
	useI18n: () => ({
		t: (key: string) => {
			const labels: Record<string, string> = {
				jsonRenderInvalidPayload: 'Invalid json-render payload',
			};
			return labels[key] ?? key;
		},
	}),
}));

vi.mock('@eit/json-render-element-plus', () => ({ elementPlusRegistry: {} }));
vi.mock('@eit/json-render-vue', () => ({
	JsonRenderPanel: defineComponent({
		props: {
			payload: { type: Object, required: true },
			onJsonRenderEvent: { type: Function, required: false },
		},
		setup(props) {
			const readPayload = (): JsonRenderPayload => props.payload as JsonRenderPayload;
			const form = ref<Record<string, unknown>>({
				...(readPayload().state?.initial?.form ?? {}),
			});
			return () => {
				const elements = Object.values(readPayload().spec.elements);
				const fields = elements.find((element) => element.type === 'DynamicForm')?.props?.fields;
				const field = Array.isArray(fields) ? (fields[0] as unknown) : undefined;
				const actions = elements.filter((element) => element.type === 'Button' && element.visible !== false);
				const fieldKey =
					field && typeof field === 'object' && 'key' in field && typeof field.key === 'string'
						? field.key
						: undefined;
				return h('div', [
					fieldKey && field
						? h('input', {
								value: form.value[fieldKey],
								disabled:
									field && typeof field === 'object' && 'disabled' in field
										? field.disabled
										: undefined,
								onInput: (event: Event) => {
									form.value[fieldKey] = (event.target as HTMLInputElement).value;
								},
							})
						: null,
					...actions.map((action) =>
						h(
							'button',
							{
								onClick: () =>
									props.onJsonRenderEvent?.({
										event: { name: action.on?.press?.action },
										payload: { form: { ...form.value } },
									}),
							},
							action.on?.press?.action === 'form.submit' ? 'Submit' : 'Cancel',
						),
					),
				]);
			};
		},
	}),
}));

import JsonRenderInteraction from '../components/JsonRenderInteraction.vue';

const payload: JsonRenderPayload = {
	format: 'json-render-v1',
	spec: appendDynamicFormToSpec(
		{ root: 'root', elements: { root: { type: 'Card', children: [] } } },
		[{ type: 'input', key: 'name', label: 'Name', value: 'Ada' }],
	),
};

describe('JsonRenderInteraction', () => {
	it('emits submitted form state only once', async () => {
		const wrapper = mount(JsonRenderInteraction, {
			props: { payload, instanceId: 'interaction-1' },
		});

		await wrapper.find('input').setValue('Grace');
		const submit = wrapper.findAll('button').find((button) => button.text() === 'Submit');
		expect(submit).toBeDefined();
		await submit!.trigger('click');
		await submit!.trigger('click');

		expect(wrapper.emitted('submit')).toEqual([[{ name: 'Grace' }]]);
	});

	it('renders resolved values as a non-interactive card', () => {
		const wrapper = mount(JsonRenderInteraction, {
			props: {
				payload,
				instanceId: 'interaction-2',
				values: { name: 'Lin' },
				readOnly: true,
				status: 'submitted',
			},
		});

		expect(wrapper.attributes('data-status')).toBe('submitted');
		expect(wrapper.find('input').attributes('disabled')).toBeDefined();
		expect(wrapper.findAll('button')).toHaveLength(0);
	});

	it('renders invalid payloads safely', () => {
		const wrapper = mount(JsonRenderInteraction, {
			props: {
				payload: { format: 'json-render-v1', spec: { root: 'missing', elements: {} } },
				instanceId: 'interaction-3',
			},
		});

		expect(wrapper.text()).toContain('Invalid json-render payload');
	});
});
