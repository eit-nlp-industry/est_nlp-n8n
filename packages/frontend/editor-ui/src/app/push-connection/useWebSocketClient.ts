import { useHeartbeat } from '@/app/push-connection/useHeartbeat';
import { useReconnectTimer } from '@/app/push-connection/useReconnectTimer';
import { ref, toValue, type MaybeRefOrGetter } from 'vue';
import { createHeartbeatMessage } from '@n8n/api-types';

export type UseWebSocketClientOptions<T> = {
	url: MaybeRefOrGetter<string>;
	onMessage: (data: T) => void;
};

/** Defined here as not available in tests */
export const WebSocketState = {
	CONNECTING: 0,
	OPEN: 1,
	CLOSING: 2,
	CLOSED: 3,
} as const;

export type WebSocketStateType = 0 | 1 | 2 | 3;

/**
 * Creates a WebSocket connection to the server. Uses reconnection logic
 * to reconnect if the connection is lost.
 */
export const useWebSocketClient = <T>(options: UseWebSocketClientOptions<T>) => {
	const isConnected = ref(false);
	/** True while a reconnect attempt is scheduled or in flight after a drop. */
	const isReconnecting = ref(false);
	const socket = ref<WebSocket | null>(null);

	/**
	 * Heartbeat timer to keep the connection alive. This is an additional
	 * mechanism to the protocol level ping/pong mechanism the server sends.
	 * This is used the ensure the client notices connection issues.
	 */
	const { startHeartbeat, stopHeartbeat } = useHeartbeat({
		interval: 30_000,
		onHeartbeat: () => {
			socket.value?.send(JSON.stringify(createHeartbeatMessage()));
		},
	});

	const onConnected = () => {
		socket.value?.removeEventListener('open', onConnected);
		isConnected.value = true;
		isReconnecting.value = false;
		startHeartbeat();
		reconnectTimer.resetConnectionAttempts();
	};

	const onConnectionLost = (event: CloseEvent) => {
		console.warn(`[WebSocketClient] Connection lost, code=${event.code ?? 'unknown'}`);
		disconnect({ scheduleReconnect: true });
	};

	const onMessage = (event: MessageEvent) => {
		options.onMessage(event.data);
	};

	const onError = (error: unknown) => {
		console.warn('[WebSocketClient] Connection error:', error);
	};

	const tearDownSocket = () => {
		if (!socket.value) {
			return;
		}

		stopHeartbeat();
		socket.value.removeEventListener('message', onMessage);
		socket.value.removeEventListener('error', onError);
		socket.value.removeEventListener('close', onConnectionLost);
		socket.value.close(1000);
		socket.value = null;
		isConnected.value = false;
	};

	const disconnect = ({ scheduleReconnect = false }: { scheduleReconnect?: boolean } = {}) => {
		reconnectTimer.stopReconnectTimer();
		tearDownSocket();

		if (scheduleReconnect) {
			isReconnecting.value = true;
			reconnectTimer.scheduleReconnect();
		} else {
			isReconnecting.value = false;
		}
	};

	const connect = () => {
		// Drop any open socket without clearing a reconnect-in-progress flag.
		reconnectTimer.stopReconnectTimer();
		tearDownSocket();

		socket.value = new WebSocket(toValue(options.url));
		socket.value.addEventListener('open', onConnected);
		socket.value.addEventListener('message', onMessage);
		socket.value.addEventListener('error', onError);
		socket.value.addEventListener('close', onConnectionLost);
		socket.value.binaryType = 'arraybuffer';
	};

	const reconnectTimer = useReconnectTimer({
		onAttempt: connect,
		onAttemptScheduled: (delay) => {
			console.log(`[WebSocketClient] Attempting to reconnect in ${delay}ms`);
		},
	});

	const sendMessage = (serializedMessage: string) => {
		if (!isConnected.value || !socket.value) {
			throw new Error('Not connected to the server');
		}

		socket.value.send(serializedMessage);
	};

	return {
		isConnected,
		isReconnecting,
		connect,
		disconnect,
		sendMessage,
	};
};
