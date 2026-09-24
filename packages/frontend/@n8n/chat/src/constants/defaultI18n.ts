import type { ChatOptions } from '@n8n/chat/types';

export const defaultI18n: ChatOptions['i18n'] = {
	en: {
		title: 'Hi there! 👋',
		subtitle: "Start a chat. We're here to help you 24/7.",
		footer: '',
		getStarted: 'New Conversation',
		inputPlaceholder: 'Type your question..',
		closeButtonTooltip: 'Close chat',
		repostButton: 'Repost message',
		reuseButton: 'Reuse message',
		jsonRenderSubmitted: 'Submitted',
		jsonRenderCancelled: 'Cancelled',
		jsonRenderSubmittedDecision: 'Submitted decision',
		jsonRenderInvalidPayload: 'Invalid json-render payload',
		jsonRenderSendFailed: "Couldn't send your decision. Try again.",
		jsonRenderRetry: 'Retry',
	},
};
