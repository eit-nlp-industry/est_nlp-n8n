import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const markerPath = new URL('../dist/.dev-ready', import.meta.url);
const aliasCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const aliasProcess = spawn(aliasCommand, ['exec', 'tsc-alias', '-p', 'tsconfig.build.json'], {
	stdio: 'inherit',
	shell: process.platform === 'win32',
});

aliasProcess.on('exit', async (code) => {
	if (code !== 0) process.exit(code ?? 1);

	await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
	await writeFile(markerPath, `${Date.now()}\n`);
});
