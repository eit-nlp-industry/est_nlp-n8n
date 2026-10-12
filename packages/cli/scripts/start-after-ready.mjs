import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const readyFile = new URL('../dist/.dev-ready', import.meta.url);

while (!existsSync(readyFile)) {
	await new Promise((resolve) => setTimeout(resolve, 250));
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmCommand, ['start', ...process.argv.slice(2)], {
	stdio: 'inherit',
	windowsHide: true,
	shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	else process.exit(code ?? 1);
});
