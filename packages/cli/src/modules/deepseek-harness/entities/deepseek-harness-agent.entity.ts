import type { DeepSeekHarnessAgentRuntimeStatus, DeepSeekHarnessAgentStatus } from '@n8n/api-types';
import { DateTimeColumn, Project, WithTimestampsAndStringId } from '@n8n/db';
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

	@Column({ type: 'boolean', default: false })
	published: boolean;

	@Column({ type: 'varchar', length: 16, default: 'stopped' })
	runtimeStatus: DeepSeekHarnessAgentRuntimeStatus;

	@Column({ type: 'integer', nullable: true })
	runtimePid: number | null;

	@Column({ type: 'integer', nullable: true })
	runtimePort: number | null;

	@Column({ type: 'text', nullable: true })
	runtimeUrl: string | null;

	@Column({ type: 'text', nullable: true })
	runtimeError: string | null;

	@DateTimeColumn({ nullable: true })
	lastStartedAt: Date | null;

	@DateTimeColumn({ nullable: true })
	lastStoppedAt: Date | null;
}
