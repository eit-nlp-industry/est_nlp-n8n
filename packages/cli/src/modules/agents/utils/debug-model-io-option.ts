/**
 * Opt-in LLM request/response snapshots for Session debug UI.
 * Only spreads the flag when enabled so ExecutionOptions stays sparse.
 */
export function debugModelIoOption(enabled: boolean): { debugModelIo?: true } {
	return enabled ? { debugModelIo: true } : {};
}
