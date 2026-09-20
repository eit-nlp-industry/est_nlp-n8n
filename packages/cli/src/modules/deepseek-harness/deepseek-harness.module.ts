import type { ModuleInterface } from '@n8n/decorators';
import { BackendModule } from '@n8n/decorators';
import { Container } from '@n8n/di';

@BackendModule({ name: 'deepseek-harness' })
export class DeepSeekHarnessModule implements ModuleInterface {
	async init() {
		await import('./deepseek-harness.controller.js');
		const { DeepSeekHarnessService } = await import('./deepseek-harness.service.js');
		Container.get(DeepSeekHarnessService);
	}

	async entities() {
		const { DeepSeekHarnessAgent } = await import(
			'./entities/deepseek-harness-agent.entity.js'
		);
		return [DeepSeekHarnessAgent];
	}
}
