import type { MigrationContext, ReversibleMigration } from '../migration-types';

export class AddUserNameToDeepSeekHarnessAgents1789558029359 implements ReversibleMigration {
	async up({ schemaBuilder: { addColumns, column } }: MigrationContext) {
		await addColumns('deepseek_harness_agents', [column('userName').varchar(254)], {
			recreatesOnSqlite: true,
		});
	}

	async down({ schemaBuilder: { dropColumns } }: MigrationContext) {
		await dropColumns('deepseek_harness_agents', ['userName'], { recreatesOnSqlite: true });
	}
}
