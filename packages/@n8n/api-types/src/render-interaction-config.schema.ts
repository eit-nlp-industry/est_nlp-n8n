import {
	extractFromAICalls,
	FROM_AI_AUTO_GENERATED_MARKER,
	isFromAIOnlyExpression,
	type INodeParameters,
	type NodeParameterValue,
} from 'n8n-workflow';
import { z } from 'zod';

const fromAITypeSchema = z.enum(['string', 'number', 'boolean', 'json']);
const fromAIValueSchema = z.object({
	$fromAI: z.object({
		key: z.string().min(1),
		description: z.string(),
		type: fromAITypeSchema,
		defaultValue: z.unknown().optional(),
	}),
});
const textValueSchema = z.union([z.string(), fromAIValueSchema]);
const requiredTextValueSchema = z.union([z.string().min(1), fromAIValueSchema]);
const numberValueSchema = z.union([z.number(), z.literal(''), fromAIValueSchema]);

const renderInteractionOptionSchema = z.object({
	value: requiredTextValueSchema,
	label: requiredTextValueSchema,
});
const renderInteractionMetricSchema = z.object({
	label: requiredTextValueSchema,
	value: requiredTextValueSchema,
	trend: z.enum(['up', 'down', 'neutral']).optional(),
	trendLabel: textValueSchema.optional(),
});
const optionsJsonSchema = z.union([z.array(renderInteractionOptionSchema), fromAIValueSchema]);
const stringListValueSchema = z.union([z.array(z.string()), fromAIValueSchema]);
const tableRowsValueSchema = z.union([z.array(z.array(textValueSchema)), fromAIValueSchema]);

const selectFieldSchema = z.object({
	key: requiredTextValueSchema,
	label: requiredTextValueSchema,
	type: z.literal('select'),
	options: z.array(renderInteractionOptionSchema),
	optionsJson: optionsJsonSchema,
	defaultValue: textValueSchema,
});
const multipleSelectFieldSchema = z.object({
	key: requiredTextValueSchema,
	label: requiredTextValueSchema,
	type: z.literal('multipleSelect'),
	options: z.array(renderInteractionOptionSchema),
	optionsJson: optionsJsonSchema,
	defaultValues: stringListValueSchema,
});
const inputNumberFieldSchema = z.object({
	key: requiredTextValueSchema,
	label: requiredTextValueSchema,
	type: z.literal('inputNumber'),
	defaultValue: numberValueSchema,
	placeholder: textValueSchema,
});
const inputFieldSchema = z.object({
	key: requiredTextValueSchema,
	label: requiredTextValueSchema,
	type: z.literal('input'),
	defaultValue: textValueSchema,
	placeholder: textValueSchema,
});

export const renderInteractionFieldSchema = z.discriminatedUnion('type', [
	selectFieldSchema,
	multipleSelectFieldSchema,
	inputNumberFieldSchema,
	inputFieldSchema,
]);
export const renderInteractionConfigSchema = z
	.object({
		title: requiredTextValueSchema,
		description: textValueSchema,
		metrics: z.array(renderInteractionMetricSchema),
		tableColumns: z.array(requiredTextValueSchema),
		tableRows: tableRowsValueSchema,
		fields: z.array(renderInteractionFieldSchema).min(1),
	})
	.superRefine((value, ctx) => {
		const keys = new Set<string>();
		for (const [index, field] of value.fields.entries()) {
			if (typeof field.key === 'string') {
				if (keys.has(field.key)) {
					ctx.addIssue({
						code: 'custom',
						message: `Duplicate field key "${field.key}"`,
						path: ['fields', index, 'key'],
					});
				}
				keys.add(field.key);
			}
			if (field.type === 'select' || field.type === 'multipleSelect') {
				const hasOptionsJson = !Array.isArray(field.optionsJson) || field.optionsJson.length > 0;
				if (field.options.length === 0 && !hasOptionsJson) {
					ctx.addIssue({
						code: 'custom',
						message: 'Add at least one option or provide Options JSON',
						path: ['fields', index, 'options'],
					});
				}
			}
		}
	});

export type RenderInteractionConfig = z.infer<typeof renderInteractionConfigSchema>;
export type RenderInteractionConfigField = z.infer<typeof renderInteractionFieldSchema>;
type FromAIValue = z.infer<typeof fromAIValueSchema>;

export function isRenderInteractionNodeType(nodeType: string): boolean {
	return /renderInteraction/i.test(nodeType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNestedRecord(
	parameters: INodeParameters,
	key: string,
): Record<string, unknown> | undefined {
	const value = parameters[key];
	return isRecord(value) ? value : undefined;
}

function fromAIValue(raw: unknown): FromAIValue | null {
	if (typeof raw !== 'string' || !isFromAIOnlyExpression(raw)) return null;
	try {
		const [argument] = extractFromAICalls(raw);
		if (!argument?.key) return null;
		return {
			$fromAI: {
				key: argument.key,
				description: argument.description ?? '',
				type: argument.type ?? 'string',
				...(argument.defaultValue !== undefined ? { defaultValue: argument.defaultValue } : {}),
			},
		};
	} catch {
		return null;
	}
}

function textValue(raw: unknown): unknown {
	return fromAIValue(raw) ?? (typeof raw === 'string' ? raw : '');
}

function parseJson(raw: unknown, fallback: unknown): unknown {
	if (typeof raw !== 'string' || !raw.trim()) return fallback;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return fallback;
	}
}

function optionList(raw: unknown): unknown[] {
	let items: unknown = raw;
	if (isRecord(items) && Array.isArray(items.option)) items = items.option;
	if (typeof items === 'string') items = parseJson(items, []);
	if (!Array.isArray(items)) return [];
	return items
		.filter(isRecord)
		.map((item) => ({ value: textValue(item.value), label: textValue(item.label) }));
}

function optionsJsonValue(raw: unknown): unknown {
	return fromAIValue(raw) ?? optionList(raw);
}

function fieldDraftFromNodeParameters(
	field: Record<string, unknown>,
): Record<string, unknown> | null {
	const type = field.type;
	if (
		type !== 'select' &&
		type !== 'multipleSelect' &&
		type !== 'inputNumber' &&
		type !== 'input'
	) {
		return null;
	}
	const draft: Record<string, unknown> = {
		key: textValue(field.key),
		label: textValue(field.label),
		type,
	};
	if (type === 'select' || type === 'multipleSelect') {
		draft.options = optionList(field.options);
		draft.optionsJson = optionsJsonValue(field.optionsJson);
	}
	if (type === 'select' || type === 'input') draft.defaultValue = textValue(field.defaultValue);
	if (type === 'multipleSelect') {
		draft.defaultValues = fromAIValue(field.defaultValues) ?? parseJson(field.defaultValues, []);
	}
	if (type === 'inputNumber') {
		const modelValue = fromAIValue(field.defaultValue);
		const rawDefault = field.defaultValue;
		const parsedDefault =
			typeof rawDefault === 'number'
				? rawDefault
				: typeof rawDefault === 'string' && rawDefault.trim()
					? Number(rawDefault)
					: '';
		draft.defaultValue = modelValue ?? (Number.isNaN(parsedDefault) ? '' : parsedDefault);
	}
	if (type === 'input' || type === 'inputNumber') {
		draft.placeholder = textValue(field.placeholder);
	}
	return draft;
}

function buildRenderInteractionDraft(parameters: INodeParameters): Record<string, unknown> {
	const fieldsRaw = readNestedRecord(parameters, 'fields')?.field;
	const fieldItems = Array.isArray(fieldsRaw) ? fieldsRaw : [];
	const metricsRaw = readNestedRecord(parameters, 'metrics')?.metrics;
	const metrics = Array.isArray(metricsRaw)
		? metricsRaw.filter(isRecord).map((metric) => ({
				label: textValue(metric.label),
				value: textValue(metric.value),
				...(typeof metric.trend === 'string' ? { trend: metric.trend } : {}),
				...(metric.trendLabel !== undefined ? { trendLabel: textValue(metric.trendLabel) } : {}),
			}))
		: [];
	const tableColumns = Array.isArray(parameters.tableColumns)
		? parameters.tableColumns.map(textValue)
		: [];
	const tableRows = fromAIValue(parameters.tableRows) ?? parseJson(parameters.tableRows, []);
	return {
		title: textValue(parameters.title),
		description: textValue(parameters.description),
		metrics,
		tableColumns,
		tableRows,
		fields: fieldItems
			.map((item) => (isRecord(item) ? fieldDraftFromNodeParameters(item) : null))
			.filter((item): item is Record<string, unknown> => item !== null),
	};
}

export function nodeParametersToRenderInteractionConfig(
	parameters: INodeParameters,
): RenderInteractionConfig | null {
	const result = renderInteractionConfigSchema.safeParse(buildRenderInteractionDraft(parameters));
	return result.success ? result.data : null;
}

function isFromAIValue(value: unknown): value is FromAIValue {
	return fromAIValueSchema.safeParse(value).success;
}

function quoteFromAIString(value: string): string {
	if (value.includes('\n') || value.includes('\r')) {
		const interpolationStart = String.fromCharCode(36, 123);
		return `\`${value
			.replaceAll('\\', '\\\\')
			.replaceAll('`', '\\`')
			.replaceAll(interpolationStart, `\\${interpolationStart}`)}\``;
	}
	return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function fromAIExpression(value: FromAIValue): string {
	const { key, description, type, defaultValue } = value.$fromAI;
	const args = [quoteFromAIString(key), quoteFromAIString(description), quoteFromAIString(type)];
	if (defaultValue !== undefined) {
		const serialized =
			typeof defaultValue === 'string' ? defaultValue : JSON.stringify(defaultValue);
		args.push(quoteFromAIString(serialized));
	}
	return `={{ ${FROM_AI_AUTO_GENERATED_MARKER} $fromAI(${args.join(', ')}) }}`;
}

function nodeValue(value: unknown): NodeParameterValue {
	if (isFromAIValue(value)) return fromAIExpression(value);
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		value === null ||
		value === undefined
	) {
		return value;
	}
	return JSON.stringify(value);
}

function nodeOptionList(options: Array<z.infer<typeof renderInteractionOptionSchema>>) {
	return options.map((option) => ({
		value: nodeValue(option.value),
		label: nodeValue(option.label),
	}));
}

function fieldToNodeParameters(field: RenderInteractionConfigField): INodeParameters {
	const common = { key: nodeValue(field.key), label: nodeValue(field.label), type: field.type };
	switch (field.type) {
		case 'select':
			return {
				...common,
				options: { option: nodeOptionList(field.options) },
				optionsJson: isFromAIValue(field.optionsJson)
					? fromAIExpression(field.optionsJson)
					: JSON.stringify(nodeOptionList(field.optionsJson)),
				defaultValue: nodeValue(field.defaultValue),
			};
		case 'multipleSelect':
			return {
				...common,
				options: { option: nodeOptionList(field.options) },
				optionsJson: isFromAIValue(field.optionsJson)
					? fromAIExpression(field.optionsJson)
					: JSON.stringify(nodeOptionList(field.optionsJson)),
				defaultValues: isFromAIValue(field.defaultValues)
					? fromAIExpression(field.defaultValues)
					: JSON.stringify(field.defaultValues),
			};
		case 'inputNumber':
			return {
				...common,
				defaultValue: isFromAIValue(field.defaultValue)
					? fromAIExpression(field.defaultValue)
					: String(field.defaultValue),
				placeholder: nodeValue(field.placeholder),
			};
		case 'input':
			return {
				...common,
				defaultValue: nodeValue(field.defaultValue),
				placeholder: nodeValue(field.placeholder),
			};
	}
}

export function renderInteractionConfigToNodeParameters(
	config: RenderInteractionConfig,
	existing: INodeParameters = {},
): INodeParameters {
	return {
		...existing,
		title: nodeValue(config.title),
		description: nodeValue(config.description),
		metrics: {
			metrics: config.metrics.map((metric) => ({
				label: nodeValue(metric.label),
				value: nodeValue(metric.value),
				...(metric.trend ? { trend: metric.trend } : {}),
				...(metric.trendLabel !== undefined ? { trendLabel: nodeValue(metric.trendLabel) } : {}),
			})),
		},
		tableColumns: config.tableColumns.map(nodeValue),
		tableRows: isFromAIValue(config.tableRows)
			? fromAIExpression(config.tableRows)
			: JSON.stringify(config.tableRows.map((row) => row.map(nodeValue))),
		fields: { field: config.fields.map(fieldToNodeParameters) },
	};
}

export function formatRenderInteractionConfig(config: RenderInteractionConfig): string {
	return `${JSON.stringify(config, null, 2)}\n`;
}

export function formatZodIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
			return `${path}${issue.message}`;
		})
		.join('\n');
}

function normalizeLegacyConfig(value: unknown): unknown {
	if (!isRecord(value)) return value;
	const legacyTable = isRecord(value.table) ? value.table : undefined;
	const rawFields: unknown[] = Array.isArray(value.fields) ? value.fields : [];
	const fields = rawFields.map((rawField) => {
		if (!isRecord(rawField)) return rawField;
		const type = rawField.type;
		if (type === 'select') {
			return {
				...rawField,
				options: Array.isArray(rawField.options) ? rawField.options : [],
				optionsJson: rawField.optionsJson ?? [],
				defaultValue: rawField.defaultValue ?? rawField.default ?? '',
			};
		}
		if (type === 'multipleSelect') {
			return {
				...rawField,
				options: Array.isArray(rawField.options) ? rawField.options : [],
				optionsJson: rawField.optionsJson ?? [],
				defaultValues: rawField.defaultValues ?? rawField.default ?? [],
			};
		}
		if (type === 'input' || type === 'inputNumber') {
			return {
				...rawField,
				defaultValue: rawField.defaultValue ?? rawField.default ?? '',
				placeholder: rawField.placeholder ?? '',
			};
		}
		return rawField;
	});
	return {
		...value,
		description: value.description ?? '',
		metrics: value.metrics ?? [],
		tableColumns: value.tableColumns ?? legacyTable?.columns ?? [],
		tableRows: value.tableRows ?? legacyTable?.rows ?? [],
		fields,
	};
}

export function parseRenderInteractionConfigText(
	text: string,
): { ok: true; config: RenderInteractionConfig } | { ok: false; error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, error: 'Invalid JSON syntax' };
	}
	const result = renderInteractionConfigSchema.safeParse(normalizeLegacyConfig(parsed));
	if (!result.success) return { ok: false, error: formatZodIssues(result.error) };
	return { ok: true, config: result.data };
}

export function serializeRenderInteractionNodeParameters(
	parameters: INodeParameters,
): string | null {
	const config = nodeParametersToRenderInteractionConfig(parameters);
	return config ? formatRenderInteractionConfig(config) : null;
}

/** Best-effort JSON for the editor, including incomplete in-progress form state. */
export function buildRenderInteractionEditorText(parameters: INodeParameters): string {
	return `${JSON.stringify(buildRenderInteractionDraft(parameters), null, 2)}\n`;
}
