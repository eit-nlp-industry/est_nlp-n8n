import type { TokenUsage } from '../sdk/agent';

export interface ModelTurnDebugRequest {
	system: unknown;
	messages: unknown[];
	toolNames?: string[];
}

export interface ModelTurnDebugResponse {
	messages: unknown[];
}

/** Opt-in debug snapshot of one LLM call for Session timeline / stream consumers. */
export interface ModelTurnDebugPayload {
	turnIndex: number;
	timestamp: number;
	endTime: number;
	model?: string;
	finishReason?: string;
	usage?: Pick<TokenUsage, 'promptTokens' | 'completionTokens' | 'totalTokens'>;
	request: ModelTurnDebugRequest;
	response: ModelTurnDebugResponse;
	/** Empty model-turn retries discarded before this snapshot (see agent runtime). */
	emptyRetries?: number;
	truncated?: boolean;
}
