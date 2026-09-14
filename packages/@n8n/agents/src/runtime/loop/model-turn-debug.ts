import type { ModelMessage, SystemModelMessage, ToolSet } from 'ai';

import type { TokenUsage } from '../../types/sdk/agent';
import type { AgentMessage } from '../../types/sdk/message';
import type {
	ModelTurnDebugPayload,
	ModelTurnDebugRequest,
	ModelTurnDebugResponse,
} from '../../types/runtime/model-turn-debug';

/** Hard cap so a single turn does not blow up session timelines. */
export const MODEL_TURN_DEBUG_MAX_BYTES = 256 * 1024;

const OMITTED_BINARY = { omitted: true, reason: 'binary' } as const;

const FILE_LIKE_TYPES = new Set(['file', 'image', 'reasoning-file', 'image-data', 'file-data']);

function isBinaryLike(value: unknown): boolean {
	return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

/**
 * Drop file/image bytes (typed arrays and base64 payloads) before snapshotting.
 * Keeps mediaType / fileRef so the debug UI still shows that a file was present.
 */
function redactHeavyParts(value: unknown, seen = new WeakSet<object>()): unknown {
	if (isBinaryLike(value)) {
		return { ...OMITTED_BINARY };
	}
	if (typeof value !== 'object' || value === null) {
		return value;
	}
	if (seen.has(value)) {
		return '[Circular]';
	}
	seen.add(value);

	if (Array.isArray(value)) {
		const out = value.map((item) => redactHeavyParts(item, seen));
		seen.delete(value);
		return out;
	}

	const record = value as Record<string, unknown>;
	const partType = record.type;
	if (typeof partType === 'string' && FILE_LIKE_TYPES.has(partType) && 'data' in record) {
		const out: Record<string, unknown> = {
			type: partType,
			omitted: true,
		};
		if (typeof record.mediaType === 'string') out.mediaType = record.mediaType;
		if (typeof record.mimeType === 'string') out.mimeType = record.mimeType;
		if (record.fileRef !== undefined) out.fileRef = redactHeavyParts(record.fileRef, seen);
		seen.delete(value);
		return out;
	}

	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(record)) {
		out[key] = redactHeavyParts(item, seen);
	}
	seen.delete(value);
	return out;
}

/** One JSON round-trip — also the source of truth for the byte budget. */
function toJsonSafe(value: unknown): unknown {
	try {
		return JSON.parse(JSON.stringify(value)) as unknown;
	} catch {
		return String(value);
	}
}

function encodeJson(value: unknown): { json: string; bytes: number } | null {
	try {
		const json = JSON.stringify(value);
		return { json, bytes: new TextEncoder().encode(json).length };
	} catch {
		return null;
	}
}

function truncateStringFields(value: unknown, maxChars: number): unknown {
	if (typeof value === 'string') {
		return value.length > maxChars ? `${value.slice(0, maxChars)}…[truncated]` : value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => truncateStringFields(item, maxChars));
	}
	if (value !== null && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = truncateStringFields(item, maxChars);
		}
		return out;
	}
	return value;
}

type PackedIo = { request: ModelTurnDebugRequest; response: ModelTurnDebugResponse };

function isPackedIo(value: unknown): value is PackedIo {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	if (typeof record.request !== 'object' || record.request === null) return false;
	if (typeof record.response !== 'object' || record.response === null) return false;
	const request = record.request as Record<string, unknown>;
	const response = record.response as Record<string, unknown>;
	return Array.isArray(request.messages) && Array.isArray(response.messages);
}

function emptyPacked(toolNames?: string[]): PackedIo {
	return {
		request: {
			system: '[omitted]',
			messages: [],
			...(toolNames ? { toolNames } : {}),
		},
		response: { messages: [] },
	};
}

function shrinkToBudget(value: PackedIo): { value: PackedIo; truncated: boolean } {
	const initial = encodeJson(value);
	if (initial !== null && initial.bytes <= MODEL_TURN_DEBUG_MAX_BYTES) {
		return { value, truncated: false };
	}

	for (const maxChars of [8_000, 2_000, 500, 200]) {
		const shrunk = truncateStringFields(value, maxChars) as PackedIo;
		const encoded = encodeJson(shrunk);
		if (encoded !== null && encoded.bytes <= MODEL_TURN_DEBUG_MAX_BYTES) {
			return { value: shrunk, truncated: true };
		}
	}

	// Hard floor: never persist a snapshot over the budget.
	return {
		value: emptyPacked(value.request.toolNames),
		truncated: true,
	};
}

export function toolNamesFromToolSet(aiTools: ToolSet | undefined): string[] | undefined {
	if (!aiTools) return undefined;
	const names = Object.keys(aiTools);
	return names.length > 0 ? names : undefined;
}

function assemblePayload(
	args: {
		turnIndex: number;
		timestamp: number;
		endTime: number;
		model?: string;
		finishReason?: string;
		usage?: TokenUsage;
		emptyRetries?: number;
	},
	io: PackedIo,
	truncated: boolean,
): ModelTurnDebugPayload {
	return {
		turnIndex: args.turnIndex,
		timestamp: args.timestamp,
		endTime: args.endTime,
		...(args.model ? { model: args.model } : {}),
		...(args.finishReason ? { finishReason: args.finishReason } : {}),
		...(args.usage
			? {
					usage: {
						promptTokens: args.usage.promptTokens,
						completionTokens: args.usage.completionTokens,
						totalTokens: args.usage.totalTokens,
					},
				}
			: {}),
		...(args.emptyRetries !== undefined && args.emptyRetries > 0
			? { emptyRetries: args.emptyRetries }
			: {}),
		request: io.request,
		response: io.response,
		...(truncated ? { truncated: true } : {}),
	};
}

/**
 * Build a JSON-safe, size-capped snapshot of one model call for Session debug UI.
 */
export function buildModelTurnDebugPayload(args: {
	turnIndex: number;
	timestamp: number;
	endTime: number;
	model?: string;
	finishReason?: string;
	usage?: TokenUsage;
	emptyRetries?: number;
	system: SystemModelMessage | SystemModelMessage[];
	messages: ModelMessage[];
	aiTools?: ToolSet;
	responseMessages: AgentMessage[];
}): ModelTurnDebugPayload {
	const toolNames = toolNamesFromToolSet(args.aiTools);
	const safe = toJsonSafe({
		request: {
			system: redactHeavyParts(args.system),
			messages: redactHeavyParts(args.messages),
			...(toolNames ? { toolNames } : {}),
		},
		response: {
			messages: redactHeavyParts(args.responseMessages),
		},
	});
	const packed = shrinkToBudget(isPackedIo(safe) ? safe : emptyPacked(toolNames));
	const truncated = packed.truncated || !isPackedIo(safe);

	const payload = assemblePayload(args, packed.value, truncated);
	const encoded = encodeJson(payload);
	if (encoded !== null && encoded.bytes <= MODEL_TURN_DEBUG_MAX_BYTES) {
		return payload;
	}

	// Metadata + IO still over budget — collapse IO to the hard floor.
	return assemblePayload(args, emptyPacked(toolNames), true);
}
