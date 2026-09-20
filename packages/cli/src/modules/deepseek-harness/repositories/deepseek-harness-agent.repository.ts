import { Service } from '@n8n/di';
import { DataSource, Like, Repository } from '@n8n/typeorm';

import { DeepSeekHarnessAgent } from '../entities/deepseek-harness-agent.entity';

@Service()
export class DeepSeekHarnessAgentRepository extends Repository<DeepSeekHarnessAgent> {
	constructor(dataSource: DataSource) {
		super(DeepSeekHarnessAgent, dataSource.manager);
	}

	async findByProjectId(projectId: string): Promise<DeepSeekHarnessAgent[]> {
		return await this.find({ where: { projectId }, order: { createdAt: 'DESC' } });
	}

	async findStartingWith(name: string): Promise<Array<Pick<DeepSeekHarnessAgent, 'name'>>> {
		return await this.find({
			select: ['name'],
			where: { name: Like(`${name}%`) },
		});
	}

	async findByIdAndProjectId(
		id: string,
		projectId: string,
	): Promise<DeepSeekHarnessAgent | null> {
		return await this.findOne({ where: { id, projectId } });
	}

	async deleteByIdAndProjectId(id: string, projectId: string): Promise<boolean> {
		const result = await this.delete({ id, projectId });
		return result.affected === 1;
	}
}
