import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import { createComponentRenderer } from '@/__tests__/render';
import ToolResultRenderer from '../components/ToolResultRenderer.vue';

const renderComponent = createComponentRenderer(ToolResultRenderer);

describe('ToolResultRenderer', () => {
	it('renders MCP image content', () => {
		const { container, getByText } = renderComponent({
			props: {
				toolName: 'screen_screenshot',
				result: {
					content: [
						{ type: 'text', text: 'current browser screenshot' },
						{ type: 'image', data: 'base64-screenshot', mimeType: 'image/png' },
					],
				},
			},
		});

		expect(getByText('current browser screenshot')).toBeInTheDocument();
		const image = container.querySelector('img');
		expect(image?.getAttribute('src')).toBe('data:image/png;base64,base64-screenshot');
	});

	it('renders AI SDK content tool output with image data', () => {
		const { container, getByText } = renderComponent({
			props: {
				toolName: 'screen_screenshot',
				result: {
					type: 'content',
					value: [
						{ type: 'text', text: 'current browser screenshot' },
						{ type: 'image-data', data: 'base64-screenshot', mediaType: 'image/png' },
					],
				},
			},
		});

		expect(getByText('current browser screenshot')).toBeInTheDocument();
		const image = container.querySelector('img');
		expect(image?.getAttribute('src')).toBe('data:image/png;base64,base64-screenshot');
	});

	it('renders AI SDK content tool output with file-data as a file', () => {
		const { container } = renderComponent({
			props: {
				toolName: 'read_file',
				result: {
					type: 'content',
					value: [{ type: 'file-data', data: 'base64-pdf', mediaType: 'application/pdf' }],
				},
			},
		});

		const iframe = container.querySelector('iframe');
		expect(iframe?.getAttribute('src')).toBe('data:application/pdf;base64,base64-pdf');
		// An `<embed>` would be refused by `object-src 'none'`.
		expect(container.querySelector('embed')).not.toBeInTheDocument();
		// An iframe needs a title where an embed did not.
		expect(iframe?.getAttribute('title')).toBeTruthy();
	});

	it('renders a json-render dashboard payload', async () => {
		const { getByText, findByText } = renderComponent({
			props: {
				toolName: 'render-ui',
				result: {
					format: 'json-render-v1',
					payload: {
						format: 'json-render-v1',
						spec: {
							root: 'root',
							elements: {
								root: { type: 'Card', props: { title: 'Weather snapshot' }, children: ['metric'] },
								metric: { type: 'Metric', props: { label: 'Shanghai', value: '22°C' } },
							},
						},
					},
				},
			},
		});

		await findByText('Weather snapshot');
		await nextTick();
		expect(getByText('Shanghai')).toBeInTheDocument();
		expect(getByText('22°C')).toBeInTheDocument();
	});
});
