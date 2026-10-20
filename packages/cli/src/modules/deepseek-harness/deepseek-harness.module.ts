import type { ModuleInterface } from '@n8n/decorators';
import { BackendModule } from '@n8n/decorators';
import { Container } from '@n8n/di';

@BackendModule({ name: 'deepseek-harness' })
export class DeepSeekHarnessModule implements ModuleInterface {
	async init() {
		await import('./deepseek-harness.controller.js');
		await import('./deepseek-harness-studio-proxy.controller.js');
		const { DeepSeekHarnessHomeService } = await import('./deepseek-harness-home.service.js');
		const { DeepSeekHarnessService } = await import('./deepseek-harness.service.js');
		void Container.get(DeepSeekHarnessHomeService)
			.cleanupStagedHomes()
			.catch((error: unknown) => {
				console.error('Failed to clean staged DeepSeek Harness homes', error);
			});
		void Container.get(DeepSeekHarnessService)
			.resumePublishedAgents()
			.catch((error: unknown) => {
				console.error('Failed to resume published DeepSeek Harness agents', error);
			});
	}

	async entities() {
		const { DeepSeekHarnessAgent } = await import('./entities/deepseek-harness-agent.entity.js');
		return [DeepSeekHarnessAgent];
	}
}
