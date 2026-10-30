import { Project, WithTimestampsAndStringId } from '@n8n/db';
import { Column, Entity, Index, JoinColumn, ManyToOne } from '@n8n/typeorm';

@Entity({ name: 'deepseek_harness_agents' })
@Index(['projectId', 'name'], { unique: true })
@Index(['directPort'], { unique: true, where: '"directPort" IS NOT NULL' })
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

	@Column({ type: 'boolean', default: false })
	published: boolean;

	/** Sticky LAN direct-access port from `N8N_DEEPSEEK_HARNESS_PORT_RANGE`. */
	@Column({ type: 'int', nullable: true })
	directPort: number | null;
}
