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

	it('reads an optional Node binary path from the environment', () => {
		process.env.N8N_DEEPSEEK_HARNESS_NODE = '/opt/glibc-node/bin/node-glibc';

		expect(Container.get(DeepSeekHarnessConfig).nodePath).toBe('/opt/glibc-node/bin/node-glibc');
	});

	it('reads sticky direct-access settings from the environment', () => {
		process.env.N8N_DEEPSEEK_HARNESS_PORT_RANGE = '13080-13089';
		process.env.N8N_DEEPSEEK_HARNESS_BIND_HOST = '10.37.0.21';
		process.env.N8N_DEEPSEEK_HARNESS_DIRECT_HOST = '10.37.0.21';
		process.env.N8N_DEEPSEEK_HARNESS_TRUSTED_HOSTS = 'n8n.home,10.37.0.21';

		const config = Container.get(DeepSeekHarnessConfig);
		expect(config.portRange).toBe('13080-13089');
		expect(config.bindHost).toBe('10.37.0.21');
		expect(config.directHost).toBe('10.37.0.21');
		expect(config.trustedHosts).toBe('n8n.home,10.37.0.21');
	});
});
