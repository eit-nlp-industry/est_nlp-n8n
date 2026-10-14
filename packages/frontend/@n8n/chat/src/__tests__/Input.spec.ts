import type { VueWrapper } from '@vue/test-utils';
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';

import Input from '../components/Input.vue';
import type { CredentialStatus } from '../types/credentialStatus';

const mockCredentialStatus: { value: CredentialStatus | null } = { value: null };

vi.mock('@vueuse/core', () => ({
	useFileDialog: vi.fn(() => ({
		open: vi.fn(),
		reset: vi.fn(),
		onChange: vi.fn(),
	})),
}));

vi.mock('uuid', () => ({
	v4: vi.fn(() => 'mock-uuid-123'),
}));

vi.mock('virtual:icons/mdi/paperclip', () => ({
	default: { name: 'IconPaperclip' },
}));

vi.mock('virtual:icons/mdi/send', () => ({
	default: { name: 'IconSend' },
}));

vi.mock('@n8n/chat/composables', () => ({
	useI18n: () => ({
		t: (key: string) => key,
	}),
	useChat: () => ({
		waitingForResponse: ref(false),
		blockUserInput: { value: false },
		websocketReady: ref(false),
		credentialStatus: mockCredentialStatus,
		currentSessionId: { value: 'session-123' },
		messages: { value: [] },
		sendMessage: vi.fn(),
		processStreamingFrame: vi.fn(),
		ws: null,
	}),
	useOptions: () => ({
		options: {
			disabled: { value: false },
			allowFileUploads: { value: true },
			allowedFilesMimeTypes: { value: 'image/*,text/*' },
			webhookUrl: 'https://example.com/webhook',
		},
	}),
}));

vi.mock('@n8n/chat/event-buses', () => ({
	chatEventBus: {
		on: vi.fn(),
		off: vi.fn(),
	},
}));

vi.mock('./ChatFile.vue', () => ({
	default: { name: 'ChatFile' },
}));

describe('ChatInput', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let wrapper: VueWrapper<any>;

	beforeEach(() => {
		// @ts-expect-error - mock WebSocket
		global.WebSocket = vi.fn().mockImplementation(
			() =>
				({
					send: vi.fn(),
					close: vi.fn(),
					onmessage: null,
					onclose: null,
				}) as unknown as WebSocket,
		);
	});

	afterEach(() => {
		if (wrapper) {
			wrapper.unmount();
		}
		vi.clearAllMocks();
		mockCredentialStatus.value = null;
	});

	it('renders the component with default props', () => {
		wrapper = mount(Input);

		expect(wrapper.find('textarea').exists()).toBe(true);
		expect(wrapper.find('[data-test-id="chat-input"]').exists()).toBe(true);
		expect(wrapper.find('.chat-input-send-button').exists()).toBe(true);
	});

	it('applies custom placeholder', () => {
		wrapper = mount(Input, {
			props: {
				placeholder: 'customPlaceholder',
			},
		});

		const textarea = wrapper.find('textarea');
		expect(textarea.attributes('placeholder')).toBe('customPlaceholder');
	});

	it('updates input value when typing', async () => {
		const textarea = wrapper.find('textarea');

		await textarea.setValue('Hello world');

		expect(wrapper.vm.input).toBe('Hello world');
	});

	it('does not submit on Shift+Enter', async () => {
		const textarea = wrapper.find('textarea');
		const onSubmitSpy = vi.spyOn(wrapper.vm, 'onSubmit');

		await textarea.setValue('Test message');
		await textarea.trigger('keydown.enter', { shiftKey: true });

		expect(onSubmitSpy).not.toHaveBeenCalled();
	});

	it('sets up WebSocket connection with execution ID', () => {
		const executionId = 'exec-123';

		wrapper.vm.setupWebsocketConnection(executionId);

		expect(global.WebSocket).toHaveBeenCalledWith(expect.stringContaining('sessionId=session-123'));
		expect(global.WebSocket).toHaveBeenCalledWith(expect.stringContaining('executionId=exec-123'));
	});

	it('does not replace an active WebSocket for the same execution', () => {
		const socket = {
			readyState: 0,
			send: vi.fn(),
			close: vi.fn(),
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
		};
		let constructionCount = 0;
		class FakeWebSocket {
			static readonly CLOSED = 3;

			constructor() {
				constructionCount++;
				return socket;
			}
		}
		// @ts-expect-error - mock WebSocket
		global.WebSocket = FakeWebSocket;

		wrapper.vm.setupWebsocketConnection('exec-123', 'token-123');
		wrapper.vm.setupWebsocketConnection('exec-123', 'token-123');

		expect(constructionCount).toBe(1);
		expect(socket.close).not.toHaveBeenCalled();
	});

	it('closes the previous WebSocket before connecting a different execution', () => {
		const events: string[] = [];
		const sockets = ['first', 'second'].map((name) => ({
			readyState: 0 as number,
			send: vi.fn(),
			close: vi.fn(() => events.push(`close-${name}`)),
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
		}));
		let socketIndex = 0;
		class FakeWebSocket {
			constructor() {
				events.push(`create-${socketIndex + 1}`);
				return sockets[socketIndex++];
			}
		}
		// @ts-expect-error - mock WebSocket
		global.WebSocket = FakeWebSocket;

		wrapper.vm.setupWebsocketConnection('exec-1', 'token-1');
		wrapper.vm.setupWebsocketConnection('exec-2', 'token-2');

		expect(events).toEqual(['create-1', 'close-first', 'create-2']);
		expect(wrapper.vm.chatStore.ws).toBe(sockets[1]);
	});

	it('sets websocketReady only after open and clears it after close', () => {
		const socket = {
			readyState: 0 as number,
			send: vi.fn(),
			close: vi.fn(),
			onopen: null as (() => void) | null,
			onmessage: null,
			onclose: null as (() => void) | null,
			onerror: null,
		};
		class FakeWebSocket {
			constructor() {
				return socket;
			}
		}
		// @ts-expect-error - mock WebSocket
		global.WebSocket = FakeWebSocket;

		wrapper.vm.setupWebsocketConnection('exec-123', 'token-123');
		expect(wrapper.vm.chatStore.websocketReady.value).toBe(false);

		socket.readyState = 1;
		socket.onopen?.();
		expect(wrapper.vm.chatStore.websocketReady.value).toBe(true);

		socket.onclose?.();
		expect(wrapper.vm.chatStore.websocketReady.value).toBe(false);
		expect(wrapper.vm.chatStore.ws).toBeNull();
	});

	it('keeps waitingForResponse true after setting up the WebSocket connection', () => {
		// The initial sendMessage clears waitingForResponse on `executionStarted`;
		// the connection setup must re-enable it so the typing indicator stays up
		// until the first bot frame arrives over the socket.
		// The shared vi.fn mock doesn't return its object from `new`, so use a
		// class that returns a captured instance (same pattern as the frame tests).
		const ws = { send: vi.fn(), onmessage: null, onclose: null };
		class FakeWebSocket {
			constructor() {
				return ws;
			}
		}
		// @ts-expect-error - mock WebSocket
		global.WebSocket = FakeWebSocket;
		wrapper = mount(Input);
		wrapper.vm.chatStore.waitingForResponse.value = false;

		wrapper.vm.setupWebsocketConnection('exec-123');

		expect(wrapper.vm.chatStore.waitingForResponse.value).toBe(true);
	});

	it('handles WebSocket messages correctly', async () => {
		const mockWs = {
			send: vi.fn(),
			onmessage: null,
			onclose: null,
		};
		wrapper.vm.chatStore.ws = mockWs;
		wrapper.vm.waitingForChatResponse = true;

		await wrapper.vm.respondToChatNode(mockWs, 'Test message');

		expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"chatInput":"Test message"'));
	});

	it('handles empty file list gracefully', () => {
		wrapper.vm.files = null;

		expect(() => wrapper.vm.attachFiles()).not.toThrow();
		expect(wrapper.vm.attachFiles()).toEqual([]);
	});

	it('prevents submit when disabled', async () => {
		const submitButton = wrapper.find('.chat-input-send-button');

		await submitButton.trigger('click');

		expect(wrapper.vm.isSubmitting).toBe(false);
	});

	describe('credential status gate', () => {
		it('disables the textarea and send button while required accounts are missing', async () => {
			mockCredentialStatus.value = { ready: false, missingCount: 1, testMode: false };
			wrapper = mount(Input);
			await wrapper.find('textarea').setValue('Hello');

			expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
			expect(wrapper.find('.chat-input-send-button').attributes('disabled')).toBeDefined();
		});

		it('does not disable the input once the host reports readiness', async () => {
			mockCredentialStatus.value = { ready: true, missingCount: 0, testMode: false };
			wrapper = mount(Input);
			await wrapper.find('textarea').setValue('Hello');

			expect(wrapper.find('textarea').attributes('disabled')).toBeUndefined();
			expect(wrapper.find('.chat-input-send-button').attributes('disabled')).toBeUndefined();
		});

		it('does not disable the input in test mode even though missingCount is 0 and ready', async () => {
			mockCredentialStatus.value = { ready: true, missingCount: 0, testMode: true };
			wrapper = mount(Input);
			await wrapper.find('textarea').setValue('Hello');

			expect(wrapper.find('textarea').attributes('disabled')).toBeUndefined();
			expect(wrapper.find('.chat-input-send-button').attributes('disabled')).toBeUndefined();
		});
	});

	describe('WebSocket frame handling (backward compatible)', () => {
		// The shared vi.fn WebSocket mock doesn't return its object from `new`, so
		// use a class that returns a captured instance we can drive directly.
		let ws: { send: ReturnType<typeof vi.fn>; onmessage: ((e: { data: string }) => void) | null };
		const emit = (data: string) => ws.onmessage?.({ data });

		beforeEach(() => {
			ws = { send: vi.fn(), onmessage: null };
			class FakeWebSocket {
				constructor() {
					return ws;
				}
			}
			// @ts-expect-error - mock WebSocket
			global.WebSocket = FakeWebSocket;
			wrapper = mount(Input);
			wrapper.vm.setupWebsocketConnection('exec-123');
		});

		it('acks a legacy string heartbeat with the legacy ack', () => {
			emit('n8n|heartbeat');

			expect(ws.send).toHaveBeenCalledWith('n8n|heartbeat-ack');
			expect(wrapper.vm.chatStore.messages.value).toHaveLength(0);
		});

		it('acks a JSON heartbeat frame with a JSON ack', () => {
			emit(JSON.stringify({ type: 'heartbeat' }));

			expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'heartbeat-ack' }));
			expect(wrapper.vm.chatStore.messages.value).toHaveLength(0);
		});

		it('treats a legacy continue frame as control, not a message', () => {
			emit('n8n|heartbeat'); // locks legacy mode
			emit('n8n|continue');

			expect(wrapper.vm.chatStore.messages.value).toHaveLength(0);
			expect(wrapper.vm.chatStore.waitingForResponse.value).toBe(true);
		});

		it('treats a JSON continue frame as control once JSON mode is established', () => {
			emit(JSON.stringify({ type: 'heartbeat' })); // locks JSON mode
			emit(JSON.stringify({ type: 'continue' }));

			expect(wrapper.vm.chatStore.messages.value).toHaveLength(0);
			expect(wrapper.vm.chatStore.waitingForResponse.value).toBe(true);
		});

		it('forwards resumed structured stream frames to the chat stream handler', () => {
			const frame = {
				type: 'item',
				content: 'continued response',
				metadata: {
					nodeId: 'agent-node',
					nodeName: 'Message an Agent',
					timestamp: 1,
					runIndex: 0,
					itemIndex: 0,
				},
			};

			emit(JSON.stringify(frame));

			expect(wrapper.vm.chatStore.processStreamingFrame).toHaveBeenCalledWith(frame);
			expect(wrapper.vm.chatStore.messages.value).toHaveLength(0);
		});

		it('renders JSON that looks like a control frame as a message when the server is legacy', () => {
			emit('n8n|heartbeat'); // locks legacy mode (single legacy ack)
			emit(JSON.stringify({ type: 'continue' }));
			emit(JSON.stringify({ type: 'heartbeat' }));

			// Both are rendered as text, not swallowed or acked as control frames
			expect(wrapper.vm.chatStore.messages.value).toHaveLength(2);
			expect(wrapper.vm.chatStore.messages.value[0]).toMatchObject({
				sender: 'bot',
				text: JSON.stringify({ type: 'continue' }),
			});
			expect(wrapper.vm.chatStore.messages.value[1]).toMatchObject({
				sender: 'bot',
				text: JSON.stringify({ type: 'heartbeat' }),
			});
			expect(ws.send).toHaveBeenCalledTimes(1);
			expect(ws.send).toHaveBeenCalledWith('n8n|heartbeat-ack');
		});

		it('keeps JSON mode when a stray legacy heartbeat arrives later', () => {
			emit(JSON.stringify({ type: 'heartbeat' })); // locks JSON mode
			emit('n8n|heartbeat'); // stray legacy frame — must NOT flip the mode
			emit(JSON.stringify({ type: 'continue' }));

			// the stray legacy heartbeat renders as a message; JSON control still works
			expect(wrapper.vm.chatStore.messages.value).toHaveLength(1);
			expect(wrapper.vm.chatStore.messages.value[0]).toMatchObject({
				sender: 'bot',
				text: 'n8n|heartbeat',
			});
			expect(wrapper.vm.chatStore.waitingForResponse.value).toBe(true);
			// only the JSON ack from the real heartbeat — no legacy ack for the stray
			expect(ws.send).toHaveBeenCalledTimes(1);
			expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'heartbeat-ack' }));
		});

		it('renders a JSON message frame as bot text', () => {
			emit(JSON.stringify({ type: 'message', text: 'Hello' }));

			expect(wrapper.vm.chatStore.messages.value).toHaveLength(1);
			expect(wrapper.vm.chatStore.messages.value[0]).toMatchObject({
				sender: 'bot',
				text: 'Hello',
			});
		});

		it('renders an interaction received from the waiting execution fallback', () => {
			const interaction = {
				type: 'agent-interaction',
				interaction: {
					runId: 'run-1',
					toolCallId: 'tool-call-1',
					interactionType: 'chat_action',
					payload: { card: { title: 'Choose a refund reason' } },
					blockUserInput: true,
				},
			};

			emit(JSON.stringify(interaction));

			expect(wrapper.vm.chatStore.messages.value).toHaveLength(1);
			expect(wrapper.vm.chatStore.messages.value[0]).toMatchObject({
				sender: 'bot',
				type: 'component',
				arguments: interaction.interaction,
			});
		});

		it('does not add a waiting execution fallback for an interaction already in the transcript', () => {
			const interaction = {
				type: 'agent-interaction',
				interaction: {
					runId: 'run-1',
					toolCallId: 'tool-call-1',
					interactionType: 'chat_action',
					payload: { card: { title: 'Choose a refund reason' } },
					blockUserInput: true,
				},
			};

			emit(JSON.stringify(interaction));
			emit(JSON.stringify(interaction));

			expect(wrapper.vm.chatStore.messages.value).toHaveLength(1);
		});

		it.each(['', JSON.stringify({ type: 'message', text: '' })])(
			'does not render an empty WebSocket message',
			(data) => {
				emit(data);

				expect(wrapper.vm.chatStore.messages.value).toHaveLength(0);
			},
		);

		it('renders a legacy raw-string message as bot text', () => {
			emit('Just some text');

			expect(wrapper.vm.chatStore.messages.value).toHaveLength(1);
			expect(wrapper.vm.chatStore.messages.value[0]).toMatchObject({
				sender: 'bot',
				text: 'Just some text',
			});
		});
	});
});
