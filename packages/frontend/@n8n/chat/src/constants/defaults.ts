import MessageJsonRender from '@n8n/chat/components/MessageJsonRender.vue';
import MessageJsonRenderInteraction from '@n8n/chat/components/MessageJsonRenderInteraction.vue';
import MessageWithButtons from '@n8n/chat/components/MessageWithButtons.vue';
import { defaultI18n } from '@n8n/chat/constants/defaultI18n';
import { MessageComponentKey } from '@n8n/chat/constants/messageComponents';
import type { ChatOptions } from '@n8n/chat/types';

export const defaultOptions: ChatOptions = {
	webhookUrl: 'http://localhost:5678',
	webhookConfig: {
		method: 'POST',
		headers: {},
	},
	target: '#n8n-chat',
	mode: 'window',
	loadPreviousSession: true,
	chatInputKey: 'chatInput',
	chatSessionKey: 'sessionId',
	defaultLanguage: 'en',
	showWelcomeScreen: false,
	initialMessages: ['Hi there! 👋', 'My name is Nathan. How can I assist you today?'],
	i18n: defaultI18n,
	theme: {},
	enableStreaming: false,
	messageComponents: {
		[MessageComponentKey.WITH_BUTTONS]: MessageWithButtons,
		[MessageComponentKey.JSON_RENDER]: MessageJsonRender,
		[MessageComponentKey.JSON_RENDER_INTERACTION]: MessageJsonRenderInteraction,
	},
};

export const defaultMountingTarget = '#n8n-chat';
