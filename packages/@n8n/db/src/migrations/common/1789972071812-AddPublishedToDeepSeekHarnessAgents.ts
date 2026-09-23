import type { MigrationContext, ReversibleMigration } from '../migration-types';

export class AddPublishedToDeepSeekHarnessAgents1789972071812 implements ReversibleMigration {
	async up({ schemaBuilder: { addColumns, column } }: MigrationContext) {
		await addColumns('deepseek_harness_agents', [column('published').bool.notNull.default(false)], {
			recreatesOnSqlite: true,
		});
	}

	async down({ schemaBuilder: { dropColumns } }: MigrationContext) {
		await dropColumns('deepseek_harness_agents', ['published'], { recreatesOnSqlite: true });
	}
}
