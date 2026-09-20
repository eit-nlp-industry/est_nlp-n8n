import type { MigrationContext, ReversibleMigration } from '../migration-types';

export class CreateDeepSeekHarnessAgents1789558029358 implements ReversibleMigration {
	async up({ schemaBuilder: { createTable, createIndex, column } }: MigrationContext) {
		await createTable('deepseek_harness_agents')
			.withColumns(
				column('id').varchar(36).primary.notNull,
				column('projectId').varchar(36).notNull,
				column('name').varchar(128).notNull,
				column('status')
					.varchar(16)
					.notNull.default("'created'")
					.withEnumCheck(['created']),
			)
			.withIndexOn('projectId')
			.withForeignKey('projectId', {
				tableName: 'project',
				columnName: 'id',
				onDelete: 'CASCADE',
			})
			.withTimestamps;

		await createIndex('deepseek_harness_agents', ['projectId', 'name'], true);
	}

	async down({ schemaBuilder: { dropTable } }: MigrationContext) {
		await dropTable('deepseek_harness_agents');
	}
}
