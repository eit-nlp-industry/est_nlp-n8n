import type { JsonRenderPayload } from '@eit/json-render-protocol';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import JsonRenderInteractionPanel from '@/features/ai/shared/JsonRenderInteractionPanel.vue';

const suspend = {
	message: '请选择要前往的实验室',
	jsonRender: {
		format: 'json-render-v1',
		schemaVersion: '1.0',
		meta: { title: '请选择要前往的实验室' },
		spec: {
			root: 'root',
			elements: {
				root: {
					type: 'Card',
					props: { title: '请选择要前往的实验室', variant: 'outlined' },
					children: ['form', 'form-actions'],
				},
				form: {
					type: 'DynamicForm',
					props: {
						fields: [
							{
								key: 'next_action',
								label: '下一步',
								type: 'select',
								value: {
									options: [{ value: 'go', label: '前往选中地点' }],
									default: 'go',
								},
							},
							{
								key: 'destination',
								label: '去哪个地点',
								type: 'select',
								value: {
									options: [
										{ value: '110实验室', label: '110实验室' },
										{ value: '', label: '' },
									],
									default: '110实验室',
								},
							},
						],
					},
				},
				'form-actions': {
					type: 'Stack',
					props: { direction: 'horizontal', gap: 'small' },
					children: ['form-submit', 'form-cancel'],
				},
				'form-submit': {
					type: 'Button',
					props: { label: 'Submit', variant: 'primary' },
					on: { press: { action: 'form.submit' } },
				},
				'form-cancel': {
					type: 'Button',
					props: { label: 'Cancel' },
					on: { press: { action: 'form.cancel' } },
				},
			},
		},
		state: { initial: { form: { next_action: 'go', destination: '110实验室' } } },
	},
};

describe('real json-render interaction panel', () => {
	it('renders the suspended form fields', async () => {
		const wrapper = mount(JsonRenderInteractionPanel, {
			props: {
				payload: suspend.jsonRender as JsonRenderPayload,
				instanceId: 'call-test',
				introMessage: suspend.message,
				status: 'open',
			},
			global: {
				stubs: {
					N8nText: { template: '<div class="intro"><slot /></div>' },
				},
			},
		});
		await wrapper.vm.$nextTick();
		const html = wrapper.html();
		expect(html).toContain('下一步');
		expect(html).toContain('去哪个地点');
		expect(html).toContain('Submit');
	});
});
