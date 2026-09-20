import { Container } from '@n8n/di';

import { DeepSeekHarnessConfig } from '../src/index';

describe('DeepSeekHarnessConfig', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		Container.reset();
		process.env = {};
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('uses the native DSH home by default', () => {
		expect(Container.get(DeepSeekHarnessConfig).home).toBe('~/.dsh');
	});

	it('reads the DSH home from the n8n environment variable', () => {
		process.env.N8N_DEEPSEEK_HARNESS_HOME = 'D:\\n8n-data\\deepseek';

		expect(Container.get(DeepSeekHarnessConfig).home).toBe('D:\\n8n-data\\deepseek');
	});
});
