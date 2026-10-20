import { N8nButton, N8nCheckbox, N8nInput } from '@n8n/design-system';
import { ElRadio } from 'element-plus';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import HarnessQuestionInteraction from '../components/HarnessQuestionInteraction.vue';

describe('HarnessQuestionInteraction', () => {
	it('collects option, multi-select, and free-text answers as one batch', async () => {
		const wrapper = mount(HarnessQuestionInteraction, {
			props: {
				payload: {
					type: 'harness-question',
					questions: [
						{
							id: 'environment',
							header: 'Environment',
							question: 'Choose an environment.',
							options: [{ label: 'Staging' }, { label: 'Production' }],
						},
						{
							id: 'checks',
							question: 'Choose checks.',
							options: [{ label: 'Unit tests' }, { label: 'Type checks' }],
							multiSelect: true,
						},
						{ id: 'notes', question: 'Add notes.' },
					],
				},
			},
		});

		wrapper.findAllComponents(ElRadio)[1]?.vm.$emit('update:modelValue', 'Production');
		wrapper.findAllComponents(N8nCheckbox)[0]?.vm.$emit('update:modelValue', true);
		wrapper.findAllComponents(N8nInput)[2]?.vm.$emit('update:modelValue', 'Ship after validation.');
		await wrapper.vm.$nextTick();
		expect(wrapper.findComponent(N8nButton).props('disabled')).toBe(false);
		await wrapper.find('form').trigger('submit');

		expect(wrapper.emitted('submit')).toEqual([
			[
				{
					answers: [
						{ id: 'environment', selected: ['Production'] },
						{ id: 'checks', selected: ['Unit tests'] },
						{ id: 'notes', selected: [], custom: 'Ship after validation.' },
					],
				},
			],
		]);
	});

	it('requires one answer for every question', async () => {
		const wrapper = mount(HarnessQuestionInteraction, {
			props: {
				payload: {
					type: 'harness-question',
					questions: [
						{ id: 'environment', question: 'Choose one.', options: [{ label: 'Staging' }] },
					],
				},
			},
		});

		expect(wrapper.findComponent(N8nButton).props('disabled')).toBe(true);
	});
});
