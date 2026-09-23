import type { MigrationContext, ReversibleMigration } from '../migration-types';

export class AddRuntimeStateToDeepSeekHarnessAgents1789970657351 implements ReversibleMigration {
	async up({ schemaBuilder: { addColumns, column } }: MigrationContext) {
		await addColumns(
			'deepseek_harness_agents',
			[
				column('runtimeStatus')
					.varchar(16)
					.notNull.default("'stopped'")
					.withEnumCheck(['stopped', 'starting', 'running', 'error'])
					.comment('Current Harness Web process state'),
				column('runtimePid').int.comment('Last spawned process ID'),
				column('runtimePort').int.comment('Last bound Harness Web port'),
				column('runtimeUrl').text.comment('Last authenticated Harness Web URL'),
				column('runtimeError').text.comment('Last Harness Web startup or runtime error'),
				column('lastStartedAt').timestamp(),
				column('lastStoppedAt').timestamp(),
			],
			{ recreatesOnSqlite: true },
		);
	}

	async down({ schemaBuilder: { dropColumns } }: MigrationContext) {
		await dropColumns(
			'deepseek_harness_agents',
			[
				'runtimeStatus',
				'runtimePid',
				'runtimePort',
				'runtimeUrl',
				'runtimeError',
				'lastStartedAt',
				'lastStoppedAt',
			],
			{ recreatesOnSqlite: true },
		);
	}
}
