import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { DeepSeekHarnessConfig } from '@n8n/config';

import { DeepSeekHarnessHomeService } from '../deepseek-harness-home.service';

describe('DeepSeekHarnessHomeService', () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'n8n-dsh-'));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('derives and creates an isolated home below the configured root', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);

		expect(service.getHome('user@example.com', 'Research agent', 'agent-1')).toBe(
			path.join(root, 'user@example.com', 'Research agent-agent-1'),
		);
		expect(await service.createHome('user@example.com', 'Research agent', 'agent-1')).toBe(
			path.join(root, 'user@example.com', 'Research agent-agent-1'),
		);
	});

	it('rejects path traversal in a profile path segment', () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);

		expect(() => service.getHome('../other', 'Agent', 'agent-1')).toThrow(
			'Invalid DeepSeek Harness path segment',
		);
	});

	it('removes a legacy profile home below the old agents directory', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);
		const legacyHome = path.join(root, 'agents', 'agent-1');

		await mkdir(legacyHome, { recursive: true });
		await service.removeLegacyHome('agent-1');

		await expect(access(legacyHome)).rejects.toThrow();
	});
});
