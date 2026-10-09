import { getThread, patchThread } from '../../storage/thread-patch';
import type { InstanceAiContext } from '../../types';
import { z } from 'zod';

const METADATA_KEY = 'instanceAiHarnessBuilderTarget';
const targetSchema = z.object({
	profileId: z.string(),
	projectId: z.string(),
	name: z.string().optional(),
	phase: z.enum(['selection', 'baseline', 'completed']).default('selection'),
	baselineSessionId: z.string().optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
});

export type HarnessBuilderTarget = z.infer<typeof targetSchema>;

export async function resolveHarnessBuilderTarget(
	context: InstanceAiContext,
): Promise<HarnessBuilderTarget | undefined> {
	if (context.harnessBuilderTarget) return context.harnessBuilderTarget;
	if (!context.threadMemory || !context.threadId) return undefined;
	const thread = await getThread(context.threadMemory, context.threadId);
	const target = targetSchema.safeParse(thread?.metadata?.[METADATA_KEY]);
	if (!target.success) return undefined;
	context.harnessBuilderTarget = target.data;
	return target.data;
}

export async function saveHarnessBuilderTarget(
	context: InstanceAiContext,
	target: HarnessBuilderTarget,
): Promise<void> {
	context.harnessBuilderTarget = target;
	if (!context.threadMemory || !context.threadId) return;
	await patchThread(context.threadMemory, {
		threadId: context.threadId,
		update: ({ metadata = {} }) => ({
			metadata: { ...metadata, [METADATA_KEY]: target },
		}),
	});
}
