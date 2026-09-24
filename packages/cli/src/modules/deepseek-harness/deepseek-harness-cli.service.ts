import { DeepSeekHarnessConfig } from '@n8n/config';
import { Service } from '@n8n/di';
import { sanitizeErrorDetail } from '@n8n/utils/redaction/sanitize-error-detail';
import { access, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';

export function getPnpmCommand(platform: NodeJS.Platform): string {
	return platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

/** Build the process used to create a profile via `--dump-config`. */
export function getInitializeProfileInvocation(
	harnessPath: string,
	profile: string,
	nodePath: string,
	platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
	const dumpArgs = [
		'--profile',
		profile,
		'--from-default-profile',
		'web',
		'--dump-config',
	] as const;

	const trimmedNode = nodePath.trim();
	if (trimmedNode) {
		return {
			command: trimmedNode,
			args: [path.join(harnessPath, 'apps', 'cli', 'lib', 'bin.js'), ...dumpArgs],
		};
	}

	const pnpmArgs = ['dsh', ...dumpArgs];
	if (platform === 'win32') {
		return {
			command: process.env.ComSpec ?? 'cmd.exe',
			args: ['/d', '/s', '/c', getPnpmCommand(platform), ...pnpmArgs],
		};
	}
	return { command: getPnpmCommand(platform), args: [...pnpmArgs] };
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

	// Profile templates ship comments plus a bare `[]`. Strip that empty
	// array so we can append real entries without invalid YAML.
	const base = retained
		.join('\n')
		.trim()
		.replace(/(?:^|\n)\[\]\s*$/u, '')
		.trim();
	if (base === '') return managedPatch;
	return `${base}\n${managedPatch}`;
}

async function execute(
	command: string,
	args: readonly string[],
	options: Parameters<typeof execFile>[2],
): Promise<void> {
	return await new Promise((resolve, reject) => {
		execFile(command, [...args], options, (error, _stdout, stderr) => {
			if (error) {
				const detail = String(stderr ?? '')
					.trim()
					.split(/\r?\n/)
					.slice(-5)
					.join(' ')
					.trim();
				if (detail) {
					reject(new Error(`${error.message}: ${sanitizeErrorDetail(detail, 2_048)}`));
					return;
				}
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

		const invocation = getInitializeProfileInvocation(
			harnessPath,
			profile,
			this.config.nodePath ?? '',
		);
		await execute(invocation.command, invocation.args, {
			cwd: harnessPath,
			env: { ...process.env, DSH_HOME: home },
			windowsHide: true,
		});

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
