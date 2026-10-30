import type { MigrationContext, ReversibleMigration } from '../migration-types';

/**
 * Sticky direct-access port for each DeepSeek Harness agent.
 *
 * When `N8N_DEEPSEEK_HARNESS_PORT_RANGE` is configured, n8n assigns one port
 * from that range per agent and reuses it across restarts so LAN clients can
 * bookmark `http://<direct-host>:<port>/`.
 */
export class AddDirectPortToDeepSeekHarnessAgents1793341621532 implements ReversibleMigration {
	async up({ schemaBuilder: { addColumns, column, createIndex } }: MigrationContext) {
		await addColumns(
			'deepseek_harness_agents',
			[
				column('directPort').int.comment(
					'Sticky LAN direct-access port from N8N_DEEPSEEK_HARNESS_PORT_RANGE',
				),
			],
			{ recreatesOnSqlite: true },
		);
		// Partial unique index: only assigned ports compete; NULL rows stay unconstrained.
		await createIndex(
			'deepseek_harness_agents',
			['directPort'],
			/*isUnique=*/ true,
			/*customIndexName=*/ undefined,
			/*whereClause=*/ '"directPort" IS NOT NULL',
		);
	}

	async down({ schemaBuilder: { dropIndex, dropColumns } }: MigrationContext) {
		await dropIndex('deepseek_harness_agents', ['directPort']);
		await dropColumns('deepseek_harness_agents', ['directPort'], { recreatesOnSqlite: true });
	}
}
