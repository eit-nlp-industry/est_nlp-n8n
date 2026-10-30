import { Config, Env } from '../decorators';

@Config
export class DeepSeekHarnessConfig {
	/** Root directory for DeepSeek Harness user data. Defaults to the native DSH home. */
	@Env('N8N_DEEPSEEK_HARNESS_HOME')
	home: string = '~/.dsh';

	/** Directory that contains the DeepSeek Harness package and its pnpm script. */
	@Env('N8N_DEEPSEEK_HARNESS_PATH')
	path: string = '';

	/** Profile name created for each n8n agent. */
	@Env('N8N_DEEPSEEK_HARNESS_PROFILE')
	profile: string = 'n8n-web';

	/**
	 * Optional Node binary for DeepSeek Harness CLI and Web.
	 * Use a glibc Node when n8n itself runs on Alpine/musl.
	 * Empty keeps the default: pnpm for profile init, process.execPath for Web.
	 */
	@Env('N8N_DEEPSEEK_HARNESS_NODE')
	nodePath: string = '';

	/**
	 * Inclusive sticky port pool, e.g. `13080-13089`.
	 * Empty keeps OS-assigned `--port 0` (proxy-only; no sticky direct access).
	 */
	@Env('N8N_DEEPSEEK_HARNESS_PORT_RANGE')
	portRange: string = '';

	/**
	 * Concrete bind address for Harness `--host` (never `0.0.0.0`).
	 * Required for LAN direct access when a port range is configured.
	 */
	@Env('N8N_DEEPSEEK_HARNESS_BIND_HOST')
	bindHost: string = '';

	/**
	 * Host/IP shown in direct-access URLs (browser-facing).
	 * Defaults to `bindHost` when empty.
	 */
	@Env('N8N_DEEPSEEK_HARNESS_DIRECT_HOST')
	directHost: string = '';

	/**
	 * Comma-separated `--trusted-host` authorities (e.g. `n8n.home,10.37.0.21`).
	 * Empty falls back to the n8n public host (`N8N_HOST` / editor base URL).
	 */
	@Env('N8N_DEEPSEEK_HARNESS_TRUSTED_HOSTS')
	trustedHosts: string = '';
}
