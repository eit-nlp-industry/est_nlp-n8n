import { Config, Env } from '../decorators';

@Config
export class DeepSeekHarnessConfig {
	/** Root directory for DeepSeek Harness user data. Defaults to the native DSH home. */
	@Env('N8N_DEEPSEEK_HARNESS_HOME')
	home: string = '~/.dsh';
}
