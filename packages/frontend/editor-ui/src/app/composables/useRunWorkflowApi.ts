import { useI18n } from '@n8n/i18n';
import type { IStartRunData } from '@/Interface';
import { usePushConnectionStore } from '@/app/stores/pushConnection.store';
import type { WorkflowDocumentId } from '@/app/stores/workflowDocument.store';
import { useWorkflowExecutionStateStore } from '@/app/stores/workflowExecutionState.store';
import { useWorkflowsStore } from '@/app/stores/workflows.store';
import type { IExecutionPushResponse } from '@/features/execution/executions/executions.types';

export function useRunWorkflowApi() {
	const i18n = useI18n();
	const pushConnectionStore = usePushConnectionStore();
	const workflowsStore = useWorkflowsStore();

	async function waitForPushConnection(timeoutMs = 5_000): Promise<boolean> {
		if (pushConnectionStore.isConnected) return true;
		// Brief reconnects used to fail Run while the Connection lost banner stayed
		// hidden (isReconnecting was folded into isConnecting). Wait a short window.
		if (!pushConnectionStore.isConnecting && !pushConnectionStore.isReconnecting) {
			return false;
		}
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (pushConnectionStore.isConnected) return true;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return pushConnectionStore.isConnected;
	}

	async function runWorkflowApi(
		runData: IStartRunData,
		documentId: WorkflowDocumentId,
	): Promise<IExecutionPushResponse> {
		if (!(await waitForPushConnection())) {
			throw new Error(i18n.baseText('workflowRun.noActiveConnectionToTheServer'));
		}

		const executionState = useWorkflowExecutionStateStore(documentId);
		// Push handlers only accept this run after the document starts tracking it.
		executionState.setActiveExecutionId(null);

		let response: IExecutionPushResponse;
		try {
			response = await workflowsStore.runWorkflow(runData);
		} catch (error) {
			executionState.setActiveExecutionId(undefined);
			throw error;
		}

		if (
			response.executionId &&
			executionState.previousExecutionId !== response.executionId &&
			executionState.activeExecutionId === null
		) {
			executionState.setActiveExecutionId(response.executionId);
		}
		if (response.waitingForWebhook === true) executionState.setExecutionWaitingForWebhook(true);
		return response;
	}

	return { runWorkflowApi };
}
