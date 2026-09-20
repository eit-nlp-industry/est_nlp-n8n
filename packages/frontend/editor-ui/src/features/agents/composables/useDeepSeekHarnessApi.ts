import type { DeepSeekHarnessAgentDto } from '@n8n/api-types';
import { makeRestApiRequest } from '@n8n/rest-api-client';
import { useRootStore } from '@n8n/stores/useRootStore';

export function useDeepSeekHarnessApi() {
	const rootStore = useRootStore();

	const listAgents = async (projectId: string): Promise<DeepSeekHarnessAgentDto[]> => {
		return await makeRestApiRequest<DeepSeekHarnessAgentDto[]>(
			rootStore.restApiContext,
			'GET',
			`/projects/${projectId}/deepseek-harness/agents`,
		);
	};

	const deleteAgent = async (projectId: string, agentId: string): Promise<void> => {
		await makeRestApiRequest(
			rootStore.restApiContext,
			'DELETE',
			`/projects/${projectId}/deepseek-harness/agents/${agentId}`,
		);
	};

	const getAgent = async (
		projectId: string,
		agentId: string,
	): Promise<DeepSeekHarnessAgentDto> => {
		return await makeRestApiRequest<DeepSeekHarnessAgentDto>(
			rootStore.restApiContext,
			'GET',
			`/projects/${projectId}/deepseek-harness/agents/${agentId}`,
		);
	};

	const createAgent = async (projectId: string): Promise<DeepSeekHarnessAgentDto> => {
		return await makeRestApiRequest<DeepSeekHarnessAgentDto>(
			rootStore.restApiContext,
			'POST',
			`/projects/${projectId}/deepseek-harness/agents`,
			{},
		);
	};

	const updateAgent = async (
		projectId: string,
		agentId: string,
		name: string,
	): Promise<DeepSeekHarnessAgentDto> => {
		return await makeRestApiRequest<DeepSeekHarnessAgentDto>(
			rootStore.restApiContext,
			'PATCH',
			`/projects/${projectId}/deepseek-harness/agents/${agentId}`,
			{ name },
		);
	};

	return { createAgent, getAgent, listAgents, deleteAgent, updateAgent };
}
