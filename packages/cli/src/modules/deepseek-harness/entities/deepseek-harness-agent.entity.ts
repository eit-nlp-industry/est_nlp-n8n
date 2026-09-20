import type { DeepSeekHarnessAgentStatus } from '@n8n/api-types';
import { Project, WithTimestampsAndStringId } from '@n8n/db';
import { Column, Entity, Index, JoinColumn, ManyToOne } from '@n8n/typeorm';

@Entity({ name: 'deepseek_harness_agents' })
@Index(['projectId', 'name'], { unique: true })
export class DeepSeekHarnessAgent extends WithTimestampsAndStringId {
	@Column({ type: 'varchar', length: 128 })
	name: string;

	@Column({ type: 'varchar', length: 254, nullable: true })
	userName: string | null;

	@ManyToOne(() => Project, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'projectId' })
	project: Project;

	@Column({ type: 'varchar', length: 36 })
	projectId: string;

	@Column({ type: 'varchar', length: 16, default: 'created' })
	status: DeepSeekHarnessAgentStatus;
}
