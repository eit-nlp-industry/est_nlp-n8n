import { Config, Env } from '../decorators';

@Config
export class ChatTriggerConfig {
	/** Whether public chat should be disabled for Chat Trigger on this instance. */
	@Env('N8N_DISABLE_PUBLIC_CHAT_TRIGGER')
	disablePublicChat: boolean = false;

	/**
	 * Base URL for Hosted Chat widget JS/CSS (no trailing slash).
	 * Default serves the locally built `@n8n/chat` bundle from this n8n process.
	 * Set to the jsDelivr URL to load the published npm package instead.
	 */
	@Env('N8N_CHAT_ASSETS_URL')
	chatAssetsUrl: string = '/n8n-chat-assets';
}
