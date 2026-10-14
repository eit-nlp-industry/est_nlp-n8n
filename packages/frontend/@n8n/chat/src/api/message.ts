import { get, post, postWithFiles } from '@n8n/chat/api/generic';
import type {
	ChatOptions,
	LoadPreviousSessionResponse,
	SendMessageResponse,
	StreamingChunk,
} from '@n8n/chat/types';

export async function loadPreviousSession(sessionId: string, options: ChatOptions) {
	const method = options.webhookConfig?.method === 'POST' ? post : get;
	return await method<LoadPreviousSessionResponse>(
		`${options.webhookUrl}`,
		{
			action: 'loadPreviousSession',
			[options.chatSessionKey as string]: sessionId,
			...(options.metadata ? { metadata: options.metadata } : {}),
		},
		{
			headers: options.webhookConfig?.headers,
		},
	);
}

export async function sendMessage(
	message: string,
	files: File[],
	sessionId: string,
	options: ChatOptions,
) {
	let response: SendMessageResponse;

	if (files.length > 0) {
		response = await postWithFiles<SendMessageResponse>(
			`${options.webhookUrl}`,
			{
				action: 'sendMessage',
				[options.chatSessionKey as string]: sessionId,
				[options.chatInputKey as string]: message,
				...(options.metadata ? { metadata: options.metadata } : {}),
			},
			files,
			{
				headers: options.webhookConfig?.headers,
			},
		);
	} else {
		const method = options.webhookConfig?.method === 'POST' ? post : get;
		response = await method<SendMessageResponse>(
			`${options.webhookUrl}`,
			{
				action: 'sendMessage',
				[options.chatSessionKey as string]: sessionId,
				[options.chatInputKey as string]: message,
				...(options.metadata ? { metadata: options.metadata } : {}),
			},
			{
				headers: options.webhookConfig?.headers,
			},
		);
	}

	return response;
}

const PROXY_TIMEOUT_ERROR_MESSAGE =
	'A proxy timeout occurred while waiting for the response. The workflow may still be running — check the execution list for results.';

function isProxyErrorHtml(line: string): boolean {
	return line.includes('<!DOCTYPE') || line.includes('<html') || line.includes('</html>');
}

// Create a transform stream that parses newline-delimited JSON
function createLineParser(): TransformStream<Uint8Array, StreamingChunk> {
	let buffer = '';
	// Once an HTML error page is detected (e.g. Cloudflare 524), all subsequent
	// non-JSON lines are suppressed and a single user-facing error is emitted.
	let insideHtmlError = false;
	let htmlErrorEmitted = false;
	const decoder = new TextDecoder();

	return new TransformStream({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true });

			// Process all complete lines in the buffer
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

			for (const line of lines) {
				if (line.trim()) {
					try {
						const parsed = JSON.parse(line) as StreamingChunk;
						insideHtmlError = false;
						controller.enqueue(parsed);
					} catch (error) {
						if (isProxyErrorHtml(line)) {
							insideHtmlError = true;
						}
						if (insideHtmlError) {
							if (!htmlErrorEmitted) {
								htmlErrorEmitted = true;
								controller.enqueue({
									type: 'error',
									content: PROXY_TIMEOUT_ERROR_MESSAGE,
								} as StreamingChunk);
							}
							continue;
						}
						// Handle non-JSON lines as plain text
						controller.enqueue({
							type: 'item',
							content: line,
						} as StreamingChunk);
					}
				}
			}
		},

		flush(controller) {
			// Process any remaining buffer content
			if (buffer.trim() && !insideHtmlError) {
				try {
					const parsed = JSON.parse(buffer) as StreamingChunk;
					controller.enqueue(parsed);
				} catch (error) {
					if (isProxyErrorHtml(buffer)) {
						if (!htmlErrorEmitted) {
							controller.enqueue({
								type: 'error',
								content: PROXY_TIMEOUT_ERROR_MESSAGE,
							} as StreamingChunk);
						}
						return;
					}
					controller.enqueue({
						type: 'item',
						content: buffer,
					} as StreamingChunk);
				}
			}
		},
	});
}

export interface StreamingEventHandlers {
	onBeginMessage: (nodeId: string, runIndex?: number) => void;
	onChunk: (chunk: string, nodeId?: string, runIndex?: number) => void;
	onEndMessage: (nodeId: string, runIndex?: number) => void | Promise<void>;
	onExecutionStarted?: (executionId: string, resumeToken: string) => void;
}

export async function sendMessageStreaming(
	message: string,
	files: File[],
	sessionId: string,
	options: ChatOptions,
	handlers: StreamingEventHandlers,
): Promise<{ hasReceivedChunks: boolean }> {
	// Build request
	const response = await (files.length > 0
		? sendWithFiles(message, files, sessionId, options)
		: sendTextOnly(message, sessionId, options));

	if (!response.ok) {
		const errorText = await response.text();
		console.error('HTTP error response:', response.status, errorText);
		throw new Error(`Error while sending message. Error: ${errorText}`);
	}

	if (!response.body) {
		throw new Error('Response body is not readable');
	}

	// Process the stream
	const reader = response.body.pipeThrough(createLineParser()).getReader();
	let hasReceivedChunks = false;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			console.log('[n8n chat] streaming frame', value);

			switch (value.type) {
				case 'execution-started':
					handlers.onExecutionStarted?.(value.executionId, value.resumeToken);
					break;
				case 'keepalive':
					break;
				case 'begin':
					handlers.onBeginMessage(value.metadata?.nodeId ?? 'unknown', value.metadata?.runIndex);
					break;
				case 'item':
					hasReceivedChunks = true;
					handlers.onChunk(
						value.content ?? '',
						value.metadata?.nodeId ?? 'unknown',
						value.metadata?.runIndex,
					);
					break;
				case 'end':
					await handlers.onEndMessage(
						value.metadata?.nodeId ?? 'unknown',
						value.metadata?.runIndex,
					);
					break;
				case 'error':
					hasReceivedChunks = true;
					handlers.onChunk(
						`Error: ${value.content ?? 'Unknown error'}`,
						value.metadata?.nodeId ?? 'unknown',
						value.metadata?.runIndex,
					);
					await handlers.onEndMessage(
						value.metadata?.nodeId ?? 'unknown',
						value.metadata?.runIndex,
					);
					break;
			}
		}
	} finally {
		reader.releaseLock();
	}

	return { hasReceivedChunks };
}

// Helper function for file uploads
async function sendWithFiles(
	message: string,
	files: File[],
	sessionId: string,
	options: ChatOptions,
): Promise<Response> {
	const formData = new FormData();
	formData.append('action', 'sendMessage');
	formData.append(options.chatSessionKey as string, sessionId);
	formData.append(options.chatInputKey as string, message);

	if (options.metadata) {
		formData.append('metadata', JSON.stringify(options.metadata));
	}

	for (const file of files) {
		formData.append('files', file);
	}

	// Exclude Content-Type to let the browser set it with the multipart boundary
	const headers: Record<string, string> = {
		Accept: 'text/plain',
		...options.webhookConfig?.headers,
	};
	delete headers['Content-Type'];

	return await fetch(options.webhookUrl, {
		method: 'POST',
		headers,
		body: formData,
	});
}

// Helper function for text-only messages
async function sendTextOnly(
	message: string,
	sessionId: string,
	options: ChatOptions,
): Promise<Response> {
	const body = {
		action: 'sendMessage',
		[options.chatSessionKey as string]: sessionId,
		[options.chatInputKey as string]: message,
		...(options.metadata ? { metadata: options.metadata } : {}),
	};

	return await fetch(options.webhookUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'text/plain',
			...options.webhookConfig?.headers,
		},
		body: JSON.stringify(body),
	});
}
