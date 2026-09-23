import { v4 as uuidv4 } from 'uuid';
import { type Plugin, computed, nextTick, ref, type Ref } from 'vue';

import * as api from '@n8n/chat/api';
import {
	ChatOptionsSymbol,
	ChatSymbol,
	MessageComponentKey,
	localStorageSessionIdKey,
} from '@n8n/chat/constants';
import { chatEventBus } from '@n8n/chat/event-buses';
import type {
	ChatMessage,
	ChatOptions,
	ChatMessageText,
	CredentialStatus,
	SendMessageResponse,
} from '@n8n/chat/types';
import { parseBotChatMessageContent, shouldBlockUserInput } from '@n8n/chat/utils';
import { StreamingMessageManager, createBotMessage } from '@n8n/chat/utils/streaming';
import {
	handleStreamingChunk,
	handleNodeStart,
	handleNodeComplete,
} from '@n8n/chat/utils/streamingHandlers';

/**
 * Creates a new user message object with a unique ID
 * @param text - The message text content
 * @param files - Optional array of files attached to the message
 * @returns A ChatMessage object representing the user's message
 */
function createUserMessage(text: string, files: File[] = []): ChatMessage {
	return {
		id: uuidv4(),
		text,
		sender: 'user',
		files,
	};
}

/**
 * Extracts text content from a message response
 * Falls back to JSON stringification if no text is found but the response object has data
 * @param response - The response object from the API
 * @returns The extracted text message or stringified response
 */
function processMessageResponse(response: SendMessageResponse): string {
	let textMessage = response.output ?? response.text ?? response.message ?? '';

	if (typeof textMessage === 'object' && textMessage.type && textMessage.type === 'text') {
		return textMessage.text;
	}

	if (textMessage === '' && Object.keys(response).length > 0) {
		try {
			textMessage = JSON.stringify(response, null, 2);
		} catch (e) {
			// Failed to stringify the object so fallback to empty string
		}
	}

	return textMessage as string;
}

function isStructuredChatFrame(response: SendMessageResponse): boolean {
	const type = 'type' in response ? (response as { type?: unknown }).type : undefined;
	return (
		type === 'json-render' ||
		type === 'json-render-interaction' ||
		type === 'with-buttons' ||
		type === 'message' ||
		type === 'error'
	);
}

function botMessageFromResponse(response: SendMessageResponse): ChatMessage {
	if (isStructuredChatFrame(response)) {
		return parseBotChatMessageContent(JSON.stringify(response));
	}

	return parseBotChatMessageContent(processMessageResponse(response));
}

function parseInteractionResponse(content: string) {
	try {
		const parsed: unknown = JSON.parse(content);
		if (
			isRecord(parsed) &&
			parsed.type === 'json-render-interaction-response' &&
			typeof parsed.approved === 'boolean'
		) {
			const value = parsed.value;
			return {
				approved: parsed.approved,
				...(isRecord(value) ? { value } : {}),
			};
		}
	} catch {
		// Other user messages are plain text.
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface EmptyStreamConfig {
	receivedMessage: Ref<ChatMessageText | null>;
	messages: Ref<ChatMessage[]>;
}

/**
 * Handles the case when a streaming response returns no chunks
 * Creates an error message explaining the likely cause
 * @param config - Configuration object containing message refs
 */
function handleEmptyStreamResponse(config: EmptyStreamConfig): void {
	const { receivedMessage, messages } = config;

	if (!receivedMessage.value) {
		receivedMessage.value = createBotMessage();
		messages.value.push(receivedMessage.value);
	} else {
		// Check if any existing messages have content
		const hasContent = messages.value.some(
			(msg) => msg.sender === 'bot' && 'text' in msg && msg.text.trim().length > 0,
		);
		if (!hasContent) {
			receivedMessage.value = createBotMessage();
			messages.value.push(receivedMessage.value);
		}
	}
	receivedMessage.value.text =
		'[No response received. This could happen if streaming is enabled in the trigger but disabled in agent node(s)]';
}

interface ErrorConfig {
	error: unknown;
	receivedMessage: Ref<ChatMessageText | null>;
	messages: Ref<ChatMessage[]>;
}

/**
 * Handles errors that occur during message sending
 * Creates an error message for the user and logs the error to console
 * @param config - Configuration object containing error and message refs
 */
function handleMessageError(config: ErrorConfig): void {
	const { error, receivedMessage, messages } = config;

	receivedMessage.value ??= createBotMessage();
	receivedMessage.value.text = 'Error: Failed to receive response';

	// Ensure the error message is added to messages array if not already there
	if (!messages.value.includes(receivedMessage.value)) {
		messages.value.push(receivedMessage.value);
	}

	console.error('Chat API error:', error);
}

interface StreamingMessageConfig {
	text: string;
	files: File[];
	sessionId: string;
	options: ChatOptions;
	messages: Ref<ChatMessage[]>;
	receivedMessage: Ref<ChatMessageText | null>;
	streamingManager: StreamingMessageManager;
	blockUserInput: Ref<boolean>;
}

/**
 * Handles sending messages with streaming enabled
 * Sets up streaming event handlers and processes the response chunks
 * @param config - Configuration object for streaming message handling
 */
async function handleStreamingMessage(config: StreamingMessageConfig): Promise<boolean> {
	const {
		text,
		files,
		sessionId,
		options,
		messages,
		receivedMessage,
		streamingManager,
		blockUserInput,
	} = config;

	const handlers: api.StreamingEventHandlers = {
		onChunk: (chunk: string, nodeId?: string, runIndex?: number) => {
			handleStreamingChunk(chunk, nodeId, streamingManager, receivedMessage, messages, runIndex);
		},
		onBeginMessage: (nodeId: string, runIndex?: number) => {
			handleNodeStart(nodeId, streamingManager, runIndex);
		},
		onEndMessage: async (nodeId: string, runIndex?: number) => {
			const shouldBlock = await handleNodeComplete(
				nodeId,
				streamingManager,
				runIndex,
				text,
				options,
				messages,
			);
			if (shouldBlock) {
				blockUserInput.value = true;
			}
		},
	};

	const { hasReceivedChunks } = await api.sendMessageStreaming(
		text,
		files,
		sessionId,
		options,
		handlers,
	);

	// Check if no chunks were received (empty stream)
	if (!hasReceivedChunks) {
		handleEmptyStreamResponse({ receivedMessage, messages });
	}

	return hasReceivedChunks;
}

interface NonStreamingMessageConfig {
	text: string;
	files: File[];
	sessionId: string;
	options: ChatOptions;
}

/**
 * Handles sending messages without streaming
 * Sends the message and processes the complete response
 * @param config - Configuration object for non-streaming message handling
 * @returns The API response or a bot message
 */
async function handleNonStreamingMessage(
	config: NonStreamingMessageConfig,
): Promise<{ response?: SendMessageResponse; botMessage?: ChatMessage }> {
	const { text, files, sessionId, options } = config;

	const sendMessageResponse = await api.sendMessage(text, files, sessionId, options);

	if (sendMessageResponse?.executionStarted) {
		return { response: sendMessageResponse };
	}

	return {
		response: sendMessageResponse,
		botMessage: botMessageFromResponse(sendMessageResponse),
	};
}

export const ChatPlugin: Plugin<ChatOptions> = {
	install(app, options) {
		app.provide(ChatOptionsSymbol, options);

		const messages = ref<ChatMessage[]>([]);
		const currentSessionId = ref<string | null>(null);
		const waitingForResponse = ref(false);
		const blockUserInput = ref(false);
		const credentialStatus = ref<CredentialStatus | null>(null);

		const initialMessages = computed<ChatMessage[]>(() =>
			(options.initialMessages ?? []).map((text) => ({
				id: uuidv4(),
				text,
				sender: 'bot',
			})),
		);

		async function sendMessage(
			text: string,
			files: File[] = [],
			sendOptions: { addToTranscript?: boolean; throwOnError?: boolean } = {},
		): Promise<SendMessageResponse | null> {
			if (sendOptions.addToTranscript !== false) {
				messages.value.push(createUserMessage(text, files));
			}
			waitingForResponse.value = true;

			void nextTick(() => {
				chatEventBus.emit('scrollToBottom');
			});

			const receivedMessage = ref<ChatMessageText | null>(null);
			const streamingManager = new StreamingMessageManager();

			try {
				// Call beforeMessageSent handler if provided
				if (options.beforeMessageSent) {
					await options.beforeMessageSent(text);
				}

				if (options?.enableStreaming) {
					const hasReceivedChunks = await handleStreamingMessage({
						text,
						files,
						sessionId: currentSessionId.value as string,
						options,
						messages,
						receivedMessage,
						streamingManager,
						blockUserInput,
					});

					// Call afterMessageSent handler if provided
					if (options.afterMessageSent) {
						await options.afterMessageSent(text, {
							hasReceivedChunks,
							message: receivedMessage.value ?? '',
						});
					}
				} else {
					const result = await handleNonStreamingMessage({
						text,
						files,
						sessionId: currentSessionId.value as string,
						options,
					});

					if (result.response?.executionStarted) {
						waitingForResponse.value = false;
						return result.response;
					}

					if (result.botMessage) {
						messages.value.push(result.botMessage);
						blockUserInput.value = shouldBlockUserInput(result.botMessage);
					}

					if (options.afterMessageSent) {
						await options.afterMessageSent(text, result.response);
					}
				}
			} catch (error) {
				handleMessageError({ error, receivedMessage, messages });
				if (sendOptions.throwOnError) throw error;
			} finally {
				waitingForResponse.value = false;
			}

			void nextTick(() => {
				chatEventBus.emit('scrollToBottom');
			});

			return null;
		}

		async function loadPreviousSession() {
			if (!options.loadPreviousSession) {
				return;
			}

			// Use provided sessionId if available, otherwise check localStorage or generate new one
			let sessionId = options.sessionId ?? localStorage.getItem(localStorageSessionIdKey);

			// Save to localStorage if it was newly generated
			if (!sessionId) {
				sessionId = uuidv4();
				localStorage.setItem(localStorageSessionIdKey, sessionId);
			}

			const previousMessagesResponse = await api.loadPreviousSession(sessionId, options);

			const restored: ChatMessage[] = [];
			for (const [index, message] of (previousMessagesResponse?.data ?? []).entries()) {
				const isHuman = message.type === 'HumanMessage' || message.id.includes('HumanMessage');
				const content = message.kwargs.content;
				if (isHuman) {
					const decision = parseInteractionResponse(content);
					if (decision) {
						const card = [...restored]
							.reverse()
							.find(
								(item) =>
									item.type === 'component' &&
									item.key === MessageComponentKey.JSON_RENDER_INTERACTION &&
									!item.arguments.resolved,
							);
						if (card?.type === 'component')
							card.arguments = { ...card.arguments, resolved: decision };
						const labels = options.i18n?.[options.defaultLanguage ?? 'en'];
						restored.push({
							id: `${index}`,
							sender: 'user',
							text: decision.approved
								? (labels?.jsonRenderSubmittedDecision ?? 'Submitted decision')
								: (labels?.jsonRenderCancelled ?? 'Cancelled'),
						});
						continue;
					}
					restored.push({ id: `${index}`, sender: 'user', text: content });
				} else {
					restored.push({ ...parseBotChatMessageContent(content), id: `${index}` });
				}
			}
			messages.value = restored;
			const lastBotMessage = [...restored].reverse().find((message) => message.sender === 'bot');
			blockUserInput.value =
				lastBotMessage?.type === 'component' &&
				lastBotMessage.key === MessageComponentKey.JSON_RENDER_INTERACTION &&
				lastBotMessage.arguments.resolved
					? false
					: lastBotMessage
						? shouldBlockUserInput(lastBotMessage)
						: false;

			// Always set currentSessionId to preserve manually set sessionIds
			currentSessionId.value = sessionId;

			// Store the sessionId in localStorage for future use
			localStorage.setItem(localStorageSessionIdKey, sessionId);

			return sessionId;
		}

		// eslint-disable-next-line @typescript-eslint/require-await
		async function startNewSession() {
			// Use provided sessionId if available, otherwise generate new one
			const existingSessionId = localStorage.getItem(localStorageSessionIdKey);

			// Only preserve existing sessionId if loadPreviousSession is enabled
			// When loadPreviousSession is false, always generate a new session
			if (existingSessionId && options.loadPreviousSession && !options.sessionId) {
				// Preserve existing sessionId (e.g., manually set by user)
				currentSessionId.value = existingSessionId;
			} else {
				currentSessionId.value = options.sessionId ?? uuidv4();
				// Generate new UUID and save to localStorage
				localStorage.setItem(localStorageSessionIdKey, currentSessionId.value);
			}
		}

		const chatStore = {
			initialMessages,
			messages,
			currentSessionId,
			waitingForResponse,
			blockUserInput,
			credentialStatus,
			loadPreviousSession,
			startNewSession,
			sendMessage,
		};

		app.provide(ChatSymbol, chatStore);
		app.config.globalProperties.$chat = chatStore;
	},
};
