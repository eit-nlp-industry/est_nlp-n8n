import type {
	ChatNodeMessageAgentInteraction,
	DeepSeekHarnessWorkflowWaitMetadata,
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { CHAT_TRIGGER_NODE_TYPE, jsonParse, NodeOperationError } from 'n8n-workflow';
import crypto from 'node:crypto';

const SESSION_ID_MAX_LENGTH = 74;

function resolveSessionId(ctx: IExecuteFunctions, itemIndex: number): string | undefined {
	const session = ctx.getNodeParameter('advanced.session.session', itemIndex, {}) as {
		sessionIdType?: string;
		sessionKey?: unknown;
	};

	if (session.sessionIdType === 'customKey') {
		const key = typeof session.sessionKey === 'string' ? session.sessionKey.trim() : '';
		if (key.length > SESSION_ID_MAX_LENGTH) {
			throw new NodeOperationError(
				ctx.getNode(),
				`Session ID must be at most ${SESSION_ID_MAX_LENGTH} characters`,
				{ itemIndex },
			);
		}
		return key || undefined;
	}

	let sessionId: unknown;
	try {
		sessionId = ctx.evaluateExpression('{{ $json.sessionId }}', itemIndex);
	} catch {}

	if (typeof sessionId !== 'string' || !sessionId.trim()) {
		try {
			const chatTrigger = ctx.getChatTrigger();
			if (chatTrigger && chatTrigger.disabled !== true) {
				const triggerName = chatTrigger.name.replace(/'/g, "\\'");
				sessionId = ctx.evaluateExpression(
					`{{ $('${triggerName}').first().json.sessionId }}`,
					itemIndex,
				);
			}
		} catch {}
	}

	if (typeof sessionId !== 'string') return undefined;
	const trimmed = sessionId.trim();
	if (!trimmed) return undefined;
	return trimmed.length > SESSION_ID_MAX_LENGTH
		? crypto.createHash('sha256').update(trimmed).digest('hex')
		: trimmed;
}

function supportsWorkflowInteraction(
	ctx: IExecuteFunctions,
	sessionId: string | undefined,
): boolean {
	if (!sessionId) return false;
	const executionContext = ctx.getExecutionContext();
	const chatTrigger = ctx.getChatTrigger();
	return (
		chatTrigger?.type === CHAT_TRIGGER_NODE_TYPE &&
		executionContext?.source !== undefined &&
		['manual', 'webhook'].includes(executionContext.source) &&
		executionContext.triggerNode?.name === chatTrigger.name &&
		executionContext.triggerNode.type === chatTrigger.type
	);
}

function toHarnessInteraction(
	ctx: IExecuteFunctions,
	suspension: DeepSeekHarnessWorkflowWaitMetadata['suspension'],
): ChatNodeMessageAgentInteraction {
	const payload = suspension.suspendPayload;
	if (
		typeof payload !== 'object' ||
		payload === null ||
		!('type' in payload) ||
		payload.type !== 'harness-question'
	) {
		throw new NodeOperationError(ctx.getNode(), 'Harness returned an unsupported interaction.');
	}
	return {
		type: 'agent-interaction',
		interaction: {
			runId: suspension.runId,
			toolCallId: suspension.toolCallId,
			interactionType: 'harness_question',
			payload,
			blockUserInput: true,
		},
	};
}

export class DeepSeekHarness implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Message a DeepSeek Harness',
		name: 'deepSeekHarness',
		icon: 'node:ai-agent',
		group: ['transform'],
		hidden: true,
		usableAsTool: true,
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Agents', 'Root Nodes'],
			},
		},
		version: 1,
		description: 'Send a message to a DeepSeek Harness agent',
		defaults: { name: 'Message a DeepSeek Harness' },
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'DeepSeek Harness Profile',
				name: 'agentId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				description: 'The DeepSeek Harness Profile to message',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: { searchListMethod: 'listDeepSeekHarnessAgents', searchable: true },
					},
					{
						displayName: 'By ID',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. agent-id',
					},
				],
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				default: '',
				required: true,
				description: 'The message to send to the agent',
				placeholder:
					'Process the refund for order {{ $json.order_id }} — confirm with the customer that it was approved.',
				typeOptions: { rows: 4 },
			},
			{
				displayName: 'Specify Workspace',
				name: 'specifyWorkspace',
				type: 'boolean',
				default: false,
				description: 'Whether to send the message to a specific workspace',
			},
			{
				displayName: 'Workspace',
				name: 'workspace',
				type: 'resourceLocator',
				default: { mode: 'list', value: 'empty-workspace' },
				required: true,
				description: 'The DeepSeek Harness workspace to use',
				displayOptions: { show: { specifyWorkspace: [true] } },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: { searchListMethod: 'listDeepSeekHarnessWorkspaces', searchable: true },
					},
					{
						displayName: 'By ID',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. workspace-id',
					},
				],
			},
			{
				displayName: 'Advanced',
				name: 'advanced',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Enable Streaming',
						name: 'enableStreaming',
						type: 'boolean',
						default: true,
						description:
							'Whether to stream the response in real time when the execution supports streaming',
					},
					{
						displayName: 'Session',
						name: 'session',
						type: 'fixedCollection',
						typeOptions: { multipleValues: false },
						default: { session: {} },
						options: [
							{
								displayName: 'Session',
								name: 'session',
								values: [
									{
										displayName: 'Session ID',
										name: 'sessionIdType',
										type: 'options',
										options: [
											{
												name: 'Connected Chat Trigger Node',
												value: 'fromInput',
											},
											{ name: 'Define Below', value: 'customKey' },
										],
										default: 'fromInput',
									},
									{
										displayName: 'Session Key From Previous Node',
										name: 'sessionKey',
										type: 'string',
										default: '={{ $json.sessionId }}',
										disabledOptions: { show: { sessionIdType: ['fromInput'] } },
										displayOptions: { show: { sessionIdType: ['fromInput'] } },
									},
									{
										displayName: 'Key',
										name: 'sessionKey',
										type: 'string',
										default: '',
										displayOptions: { show: { sessionIdType: ['customKey'] } },
									},
								],
							},
						],
					},
				],
			},
		],
	};

	methods = {
		listSearch: {
			async listDeepSeekHarnessAgents(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<{ results: Array<{ name: string; value: string }> }> {
				if (!this.listDeepSeekHarnessAgents) return { results: [] };
				const agents = await this.listDeepSeekHarnessAgents();
				const query = filter?.toLowerCase();
				return {
					results: agents
						.filter((agent) => !query || agent.name.toLowerCase().includes(query))
						.map((agent) => ({ name: agent.name, value: agent.id })),
				};
			},
			async listDeepSeekHarnessWorkspaces(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<{ results: Array<{ name: string; value: string }> }> {
				const context = this as ILoadOptionsFunctions & {
					listDeepSeekHarnessWorkspaces?: (
						agentId: string,
					) => Promise<Array<{ id: string; name: string }>>;
				};
				if (!context.listDeepSeekHarnessWorkspaces) return { results: [] };
				const agent = this.getNodeParameter('agentId') as { value?: string } | string;
				const agentId = (typeof agent === 'string' ? agent : agent.value)?.trim();
				if (!agentId) return { results: [] };
				const workspaces = await context.listDeepSeekHarnessWorkspaces(agentId);
				const query = filter?.toLowerCase();
				return {
					results: workspaces
						.filter((workspace) => !query || workspace.name.toLowerCase().includes(query))
						.map((workspace) => ({
							name: workspace.name,
							value: workspace.name === 'empty-workspace' ? 'empty-workspace' : workspace.id,
						})),
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const input = this.getInputData();
		let waiting = this.getExecuteData?.()?.metadata?.deepSeekHarnessWorkflowSuspension;
		const output: INodeExecutionData[] = waiting ? [...waiting.completedItems] : [];
		const executionId = this.getExecutionId() ?? crypto.randomUUID();

		for (let index = waiting?.itemIndex ?? 0; index < input.length; index++) {
			const agent = this.getNodeParameter('agentId', index) as { value?: string } | string;
			const agentId = (typeof agent === 'string' ? agent : agent.value)?.trim();
			const message = String(this.getNodeParameter('message', index, '')).trim();
			const specifyWorkspace = this.getNodeParameter('specifyWorkspace', index, false) === true;
			const workspace = this.getNodeParameter('workspace', index, {}) as
				| { value?: string }
				| string;
			const workspaceId = specifyWorkspace
				? (typeof workspace === 'string' ? workspace : workspace.value)?.trim()
				: undefined;
			const advanced = this.getNodeParameter('advanced', index, {}) as {
				enableStreaming?: boolean;
			};
			const sessionId = waiting?.sessionId ?? resolveSessionId(this, index);
			const supportsHitl = supportsWorkflowInteraction(this, sessionId);
			if (!agentId)
				throw new NodeOperationError(this.getNode(), 'A DeepSeek Harness agent is required');
			if (!message) throw new NodeOperationError(this.getNode(), 'Message cannot be empty');

			const result = await this.executeAgent(
				{
					deepSeekHarnessAgentId: agentId,
					...(workspaceId ? { workspaceId } : {}),
					...(sessionId ? { sessionId } : {}),
					...(advanced.enableStreaming === false ? { enableStreaming: false } : {}),
					...(supportsHitl ? { supportsHitl: true } : {}),
					...(waiting?.resumeCommand ? { resume: waiting.resumeCommand } : {}),
				},
				message,
				executionId,
				index,
			);

			if (result.suspension) {
				const suspension = result.suspension.suspensions[0];
				if (!suspension) {
					throw new NodeOperationError(this.getNode(), 'Harness returned an empty suspension.');
				}
				const interaction = toHarnessInteraction(this, suspension);
				const metadata: DeepSeekHarnessWorkflowWaitMetadata = {
					agentId: result.suspension.agentId,
					sessionId: result.suspension.threadId,
					itemIndex: index,
					completedItems: [...output],
					suspension,
				};
				this.setMetadata({ deepSeekHarnessWorkflowSuspension: metadata });
				output.push({ json: {}, sendMessage: interaction, pairedItem: { item: index } });
				await this.putExecutionToWait(new Date('9999-12-31T23:59:59.999Z'));
				return [output];
			}
			if (waiting) {
				this.setMetadata({ deepSeekHarnessWorkflowSuspension: undefined });
				waiting = undefined;
			}

			output.push({
				json: {
					text: result.response,
					session: result.session as unknown as IDataObject,
				},
				pairedItem: { item: index },
			});
		}

		return [output];
	}

	async onMessage(this: IExecuteFunctions, context: IExecuteFunctions, data: INodeExecutionData) {
		const waiting = context.getExecuteData().metadata?.deepSeekHarnessWorkflowSuspension;
		if (!waiting) return [[data]];

		const input = data.json?.chatInput;
		const envelope =
			typeof input === 'string'
				? jsonParse<unknown>(input, { errorMessage: 'Invalid Harness suspension response' })
				: input;
		if (
			typeof envelope !== 'object' ||
			envelope === null ||
			!('type' in envelope) ||
			envelope.type !== 'agent-suspension-response' ||
			!('runId' in envelope) ||
			!('toolCallId' in envelope) ||
			envelope.runId !== waiting.suspension.runId ||
			envelope.toolCallId !== waiting.suspension.toolCallId
		) {
			throw new NodeOperationError(
				context.getNode(),
				'This Harness interaction is no longer active.',
			);
		}

		context.setMetadata({
			deepSeekHarnessWorkflowSuspension: {
				...waiting,
				resumeCommand: {
					runId: waiting.suspension.runId,
					toolCallId: waiting.suspension.toolCallId,
					resumeData: 'resumeData' in envelope ? envelope.resumeData : undefined,
				},
			},
		});
		return [[data]];
	}
}
