import { Tool } from '@n8n/agents';
import { UserError } from 'n8n-workflow';

import { RENDER_UI_TOOL_ID } from '../tool-ids';
import { buildRenderUiDashboardPayload } from './render-ui.payload';
import {
	JSON_RENDER_V1_FORMAT,
	renderUiInputSchema,
	renderUiOutputSchema,
	type RenderUiInput,
} from './render-ui.schema';

export { RENDER_UI_TOOL_ID };

export function createRenderUiTool() {
	return new Tool(RENDER_UI_TOOL_ID)
		.description(
			'Render a structured dashboard in the chat UI (cards, KPI metrics, and a data table). ' +
				'Use this instead of markdown tables when the user wants a snapshot, comparison, report, or KPI view. ' +
				'Pass real numbers you already have — do not invent metrics. ' +
				'Do not use this to build or edit workflows. ' +
				'Do not use ask-user for this; this tool is display-only.',
		)
		.input(renderUiInputSchema)
		.output(renderUiOutputSchema)
		.handler(async (input: RenderUiInput) => {
			if ((input.metrics?.length ?? 0) === 0 && input.table === undefined) {
				throw new UserError('render-ui requires at least one metric or a table');
			}

			return {
				format: JSON_RENDER_V1_FORMAT,
				payload: buildRenderUiDashboardPayload(input),
			};
		})
		.build();
}
