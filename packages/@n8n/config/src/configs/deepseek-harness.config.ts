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
}
