import { Service } from '@n8n/di';
import type { DeepSeekHarnessAgentRuntimeStatus } from '@n8n/api-types';
import { DataSource, Like, Repository } from '@n8n/typeorm';

import { DeepSeekHarnessAgent } from '../entities/deepseek-harness-agent.entity';

export type DeepSeekHarnessRuntimeState = {
	status: DeepSeekHarnessAgentRuntimeStatus;
	pid: number | null;
	port: number | null;
	url: string | null;
	error: string | null;
};

@Service()
export class DeepSeekHarnessAgentRepository extends Repository<DeepSeekHarnessAgent> {
	constructor(dataSource: DataSource) {
		super(DeepSeekHarnessAgent, dataSource.manager);
	}

	async findByProjectId(projectId: string): Promise<DeepSeekHarnessAgent[]> {
		return await this.find({ where: { projectId }, order: { createdAt: 'DESC' } });
	}

	async findPublished(): Promise<DeepSeekHarnessAgent[]> {
		return await this.find({ where: { published: true } });
	}

	async findStartingWith(name: string): Promise<Array<Pick<DeepSeekHarnessAgent, 'name'>>> {
		return await this.find({
			select: ['name'],
			where: { name: Like(`${name}%`) },
		});
	}

	async findByIdAndProjectId(id: string, projectId: string): Promise<DeepSeekHarnessAgent | null> {
		return await this.findOne({ where: { id, projectId } });
	}

	async deleteByIdAndProjectId(id: string, projectId: string): Promise<boolean> {
		const result = await this.delete({ id, projectId });
		return result.affected === 1;
	}

	async updateRuntimeState(id: string, state: DeepSeekHarnessRuntimeState): Promise<void> {
		const now = new Date();
		await this.update(
			{ id },
			{
				runtimeStatus: state.status,
				runtimePid: state.pid,
				runtimePort: state.port,
				// The Web URL contains a short-lived authentication token. Keep it in memory only.
				runtimeUrl: null,
				runtimeError: state.error,
				...(state.status === 'running' ? { lastStartedAt: now } : {}),
				...(state.status === 'stopped' || state.status === 'error' ? { lastStoppedAt: now } : {}),
			},
		);
	}
}
