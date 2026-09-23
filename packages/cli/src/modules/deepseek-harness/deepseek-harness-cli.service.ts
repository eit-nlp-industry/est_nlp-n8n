import { DeepSeekHarnessConfig } from '@n8n/config';
import { Service } from '@n8n/di';
import { access, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';

export function getPnpmCommand(platform: NodeJS.Platform): string {
	return platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

const WORKSPACE_PATCH_MARKER = '# n8n-managed workspace directory';

function workspacePatch(home: string): string {
	return `${WORKSPACE_PATCH_MARKER}
- id: workspace-controller
  name: "@deepseek-ai/dsh-api-workspace-controller"
  config:
    documentsDirectory: ${JSON.stringify(home)}
`;
}

function replaceWorkspacePatch(content: string, home: string): string {
	const managedPatch = workspacePatch(home);
	const retained: string[] = [];
	let skippingManagedEntry = false;
	for (const line of content.split(/\r?\n/)) {
		if (line.trim() === WORKSPACE_PATCH_MARKER || /^- id:\s*workspace-controller\s*$/.test(line)) {
			skippingManagedEntry = true;
			continue;
		}
		if (skippingManagedEntry && /^- id:\s*/.test(line)) skippingManagedEntry = false;
		if (!skippingManagedEntry) retained.push(line);
	}

	const base = retained.join('\n').trim();
	if (base === '' || base === '[]') return managedPatch;
	return `${base}\n${managedPatch}`;
}

async function execute(
	command: string,
	args: readonly string[],
	options: Parameters<typeof execFile>[2],
): Promise<void> {
	return await new Promise((resolve, reject) => {
		execFile(command, [...args], options, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

@Service()
export class DeepSeekHarnessCliService {
	constructor(private readonly config: DeepSeekHarnessConfig) {}

	async ensureWorkspaceDirectory(
		home: string,
		profile = this.config.profile.trim(),
	): Promise<void> {
		const patchPath = path.join(home, 'profiles', profile, 'cordis.patch.yml');
		const content = await readFile(patchPath, 'utf8');
		const next = replaceWorkspacePatch(content, home);
		if (next !== content) await writeFile(patchPath, next, 'utf8');
	}

	async initializeProfile(home: string): Promise<void> {
		const harnessPath = this.config.path.trim();
		if (!harnessPath) {
			throw new Error('N8N_DEEPSEEK_HARNESS_PATH is not configured');
		}

		const profile = this.config.profile.trim();
		if (!profile) throw new Error('N8N_DEEPSEEK_HARNESS_PROFILE cannot be empty');

		const pnpmArgs = [
			'dsh',
			'--profile',
			profile,
			'--from-default-profile',
			'web',
			'--dump-config',
		];
		const isWindows = process.platform === 'win32';
		await execute(
			isWindows ? (process.env.ComSpec ?? 'cmd.exe') : getPnpmCommand(process.platform),
			isWindows ? ['/d', '/s', '/c', getPnpmCommand(process.platform), ...pnpmArgs] : pnpmArgs,
			{
				cwd: harnessPath,
				env: { ...process.env, DSH_HOME: home },
				windowsHide: true,
			},
		);

		const profilePath = path.join(home, 'profiles', profile);
		try {
			await access(path.join(profilePath, 'package.json'));
			await access(path.join(profilePath, 'cordis.patch.yml'));
		} catch {
			throw new Error('DeepSeek Harness profile initialization did not create the expected files');
		}
		await this.ensureWorkspaceDirectory(home, profile);
	}
}
