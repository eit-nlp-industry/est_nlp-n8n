import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

import { vi } from 'vitest';

import { DeepSeekHarnessCliService, getPnpmCommand } from '../deepseek-harness-cli.service';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

describe('DeepSeekHarnessCliService', () => {
	let home: string;

	beforeEach(async () => {
		home = await mkdtemp(path.join(tmpdir(), 'n8n-dsh-cli-'));
		vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
			const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
			callback(null, '', '');
			return undefined as never;
		});
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it('rejects initialization when the Harness path is missing', async () => {
		const service = new DeepSeekHarnessCliService({
			path: '',
			profile: 'n8n-web',
		} as never);

		await expect(service.initializeProfile(home)).rejects.toThrow(
			'N8N_DEEPSEEK_HARNESS_PATH is not configured',
		);
		expect(execFile).not.toHaveBeenCalled();
	});

	it('initializes the configured profile with an isolated DSH_HOME', async () => {
		const harnessPath = path.join(home, 'harness');
		const profilePath = path.join(home, 'profiles', 'n8n-web');
		const service = new DeepSeekHarnessCliService({
			path: harnessPath,
			profile: 'n8n-web',
		} as never);

		vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
			const options = args[2] as { env: NodeJS.ProcessEnv };
			const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
			expect(options.env.DSH_HOME).toBe(home);
			void mkdir(profilePath, { recursive: true }).then(async () => {
				await writeFile(path.join(profilePath, 'package.json'), '{}');
				await writeFile(path.join(profilePath, 'cordis.patch.yml'), '[]\n');
				callback(null, '', '');
			});
			return undefined as never;
		});

		await service.initializeProfile(home);

		const patch = await readFile(path.join(profilePath, 'cordis.patch.yml'), 'utf8');
		expect(patch).toContain('documentsDirectory:');
		expect(patch).toContain(JSON.stringify(home));

		expect(execFile).toHaveBeenCalledWith(
			process.platform === 'win32' ? process.env.ComSpec : getPnpmCommand(process.platform),
			process.platform === 'win32'
				? [
						'/d',
						'/s',
						'/c',
						'pnpm.cmd',
						'dsh',
						'--profile',
						'n8n-web',
						'--from-default-profile',
						'web',
						'--dump-config',
					]
				: ['dsh', '--profile', 'n8n-web', '--from-default-profile', 'web', '--dump-config'],
			expect.objectContaining({
				cwd: harnessPath,
			}),
			expect.any(Function),
		);
	});

	it('updates the workspace directory patch without duplicating it', async () => {
		const profilePath = path.join(home, 'profiles', 'n8n-web');
		await mkdir(profilePath, { recursive: true });
		await writeFile(path.join(profilePath, 'package.json'), '{}');
		await writeFile(
			path.join(profilePath, 'cordis.patch.yml'),
			'- id: workspace-controller\n  name: "@deepseek-ai/dsh-api-workspace-controller"\n  config:\n    documentsDirectory: old-home\n',
		);
		const renamedProfilePath = path.join(home, 'renamed', 'profiles', 'n8n-web');
		await mkdir(renamedProfilePath, { recursive: true });
		await writeFile(path.join(renamedProfilePath, 'cordis.patch.yml'), await readFile(path.join(profilePath, 'cordis.patch.yml')));
		const service = new DeepSeekHarnessCliService({ path: home, profile: 'n8n-web' } as never);

		await service.ensureWorkspaceDirectory(home, 'n8n-web');
		await service.ensureWorkspaceDirectory(path.join(home, 'renamed'), 'n8n-web');

		const patch = await readFile(path.join(renamedProfilePath, 'cordis.patch.yml'), 'utf8');
		expect(patch.match(/id: workspace-controller/g)).toHaveLength(1);
		expect(patch).toContain(JSON.stringify(path.join(home, 'renamed')));
		expect(patch).not.toContain('old-home');
	});

	it('rejects when the CLI exits without creating the profile files', async () => {
		const service = new DeepSeekHarnessCliService({
			path: home,
			profile: 'n8n-web',
		} as never);

		await expect(service.initializeProfile(home)).rejects.toThrow(
			'DeepSeek Harness profile initialization did not create the expected files',
		);
	});
});

describe('getPnpmCommand', () => {
	it('uses the Windows command name on Windows', () => {
		expect(getPnpmCommand('win32')).toBe('pnpm.cmd');
	});

	it('uses the POSIX command name on other platforms', () => {
		expect(getPnpmCommand('linux')).toBe('pnpm');
	});
});
