import { DeepSeekHarnessConfig } from '@n8n/config';
import { Service } from '@n8n/di';
import { mkdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

function resolveHome(value: string): string {
	if (value === '~') return homedir();
	if (value.startsWith('~/') || value.startsWith('~\\')) {
		return path.join(homedir(), value.slice(2));
	}
	return path.resolve(value);
}

function resolveSegment(value: string): string {
	if (/[\\/]/.test(value)) {
		throw new Error('Invalid DeepSeek Harness path segment');
	}

	const segment = value
		.trim()
		.replace(/[<>:"/\\|?*]/g, '_')
		.replace(/[. ]+$/, '');

	if (!segment || segment === '.' || segment === '..') {
		throw new Error('Invalid DeepSeek Harness path segment');
	}

	return segment;
}

@Service()
export class DeepSeekHarnessHomeService {
	constructor(private readonly config: DeepSeekHarnessConfig) {}

	getHome(userName: string, agentName: string, agentId: string): string {
		const userSegment = resolveSegment(userName);
		const agentSegment = resolveSegment(agentName);
		const idSegment = resolveSegment(agentId);

		return path.join(resolveHome(this.config.home), userSegment, `${agentSegment}-${idSegment}`);
	}

	async createHome(userName: string, agentName: string, agentId: string): Promise<string> {
		const home = this.getHome(userName, agentName, agentId);
		await mkdir(home, { recursive: true });
		return home;
	}

	async removeHome(userName: string, agentName: string, agentId: string): Promise<void> {
		await rm(this.getHome(userName, agentName, agentId), { recursive: true, force: true });
	}

	async renameHome(
		userName: string,
		oldAgentName: string,
		newAgentName: string,
		agentId: string,
	): Promise<void> {
		await rename(
			this.getHome(userName, oldAgentName, agentId),
			this.getHome(userName, newAgentName, agentId),
		);
	}

	async removeLegacyHome(agentId: string): Promise<void> {
		await rm(path.join(resolveHome(this.config.home), 'agents', resolveSegment(agentId)), {
			recursive: true,
			force: true,
		});
	}
}
