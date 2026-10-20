import type { TokenUsage } from '../sdk/agent';

/**
 * Opt-in debug record of one model HTTP call for Session timeline / stream
 * consumers. Request is parsed JSON. Response is the final aggregated
 * completion (not the raw SSE transcript). No redaction or truncation.
 */
export interface ModelTurnDebugPayload {
	turnIndex: number;
	timestamp: number;
	endTime: number;
	model?: string;
	finishReason?: string;
	usage?: Pick<TokenUsage, 'promptTokens' | 'completionTokens' | 'totalTokens'>;
	/** Empty model-turn retries discarded before this HTTP call (see agent runtime). */
	emptyRetries?: number;
	/** Absolute URL of the model HTTP call, as sent. */
	url: string;
	method?: string;
	status?: number;
	/** True when the response Content-Type looked like an SSE stream. */
	streamed?: boolean;
	/** Parsed request JSON (or raw text if not JSON). */
	requestBody?: unknown;
	/** Final completion JSON aggregated from the stream (or parsed non-stream body). */
	responseBody?: unknown;
	error?: string;
}
