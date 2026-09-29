import {
	appendDynamicFormToSpec,
	buildDisplayDashboardSpec,
	type DisplayDashboardInput,
} from '@eit/json-render-protocol';

const JSON_RENDER_V1_FORMAT = 'json-render-v1';

export type InteractionSelectOption = {
	value: string;
	label: string;
};

export type InteractionFormField =
	| {
			key: string;
			label: string;
			type: 'select';
			options: InteractionSelectOption[];
			default?: string;
	  }
	| {
			key: string;
			label: string;
			type: 'multipleSelect';
			options: InteractionSelectOption[];
			default?: string[];
	  }
	| {
			key: string;
			label: string;
			type: 'inputNumber';
			default?: number;
			placeholder?: string;
	  }
	| {
			key: string;
			label: string;
			type: 'input';
			default?: string;
			placeholder?: string;
	  };

export type RenderInteractionInput = DisplayDashboardInput & {
	fields: InteractionFormField[];
};

function toProtocolFormField(field: InteractionFormField) {
	switch (field.type) {
		case 'select':
			return {
				key: field.key,
				label: field.label,
				type: 'select' as const,
				value: {
					options: field.options,
					default: field.default ?? field.options[0]?.value ?? '',
				},
			};
		case 'multipleSelect':
			return {
				key: field.key,
				label: field.label,
				type: 'multipleSelect' as const,
				value: {
					options: field.options,
					default: field.default ?? [],
					multiple: true,
				},
			};
		case 'inputNumber':
			return {
				key: field.key,
				label: field.label,
				type: 'inputNumber' as const,
				value: field.default ?? 0,
				...(field.placeholder ? { placeholder: field.placeholder } : {}),
			};
		case 'input':
			return {
				key: field.key,
				label: field.label,
				type: 'input' as const,
				value: field.default ?? '',
				...(field.placeholder ? { placeholder: field.placeholder } : {}),
			};
	}
}

export function buildRenderInteractionPayload(input: RenderInteractionInput) {
	const protocolFields = input.fields.map(toProtocolFormField);
	const dashboardSpec = buildDisplayDashboardSpec(input);

	return {
		format: JSON_RENDER_V1_FORMAT,
		payload: {
			format: JSON_RENDER_V1_FORMAT,
			schemaVersion: '1.0',
			meta: {
				title: input.title,
				...(input.description ? { description: input.description } : {}),
				extensions: { renderModule: 'element-plus', phase: 'decision' },
			},
			spec: appendDynamicFormToSpec(dashboardSpec, protocolFields),
			state: {
				initial: {
					form: Object.fromEntries(
						protocolFields.map((field) => {
							if (field.type === 'select') {
								const value = field.value as { default?: string };
								return [field.key, value.default ?? ''];
							}
							if (field.type === 'multipleSelect') {
								const value = field.value as { default?: string[] };
								return [field.key, value.default ?? []];
							}
							return [field.key, field.value ?? ''];
						}),
					),
				},
			},
		},
	};
}
