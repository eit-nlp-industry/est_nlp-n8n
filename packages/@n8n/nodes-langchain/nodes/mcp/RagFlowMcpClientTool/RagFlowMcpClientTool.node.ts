import { getConnectionHintNoticeField } from '@n8n/ai-utilities';
import {
	type IExecuteFunctions,
	type INodeExecutionData,
	NodeConnectionTypes,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import { getTools } from '../McpClientTool/loadOptions';
import type { McpToolIncludeMode } from '../McpClientTool/types';
import { credentials, transportSelect } from '../shared/descriptions';
import { buildMcpToolkit, executeMcpTool, type ResolvedMcpConfig } from '../shared/runtime';
import type { McpAuthenticationOption, McpServerTransport } from '../shared/types';

/** Default RAGFlow MCP SSE endpoint. */
const DEFAULT_RAGFLOW_MCP_ENDPOINT = 'http://10.37.0.21:9382/sse';

function resolveConfigFromNodeParameters(
	ctx: ISupplyDataFunctions | IExecuteFunctions,
	itemIndex: number,
): ResolvedMcpConfig {
	const authentication = ctx.getNodeParameter(
		'authentication',
		itemIndex,
	) as McpAuthenticationOption;
	const timeout = ctx.getNodeParameter('options.timeout', itemIndex, 60000) as number;
	const transport = ctx.getNodeParameter('serverTransport', itemIndex) as McpServerTransport;
	const endpointUrl = ctx.getNodeParameter('endpointUrl', itemIndex) as string;

	return {
		authentication,
		transport,
		endpointUrl,
		timeout,
		toolFilter: {
			mode: ctx.getNodeParameter('include', itemIndex) as McpToolIncludeMode,
			includeTools: ctx.getNodeParameter('includeTools', itemIndex, []) as string[],
			excludeTools: ctx.getNodeParameter('excludeTools', itemIndex, []) as string[],
		},
	};
}

/**
 * MCP Client Tool prefilled for RAGFlow. Same runtime as McpClientTool;
 * defaults match a typical self-hosted RAGFlow MCP SSE setup and stay editable.
 */
export class RagFlowMcpClientTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'RAGFlow',
		name: 'ragFlowMcpClientTool',
		icon: {
			light: 'file:../mcp.svg',
			dark: 'file:../mcp.dark.svg',
		},
		group: ['output'],
		// Keep >= 1.1 so shared getTools() reads endpointUrl + serverTransport (not sseEndpoint).
		version: 1.2,
		description: 'Connect tools from the RAGFlow MCP Server',
		defaults: {
			name: 'RAGFlow',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Model Context Protocol'],
			},
			alias: ['RAGFlow', 'RAG', 'Model Context Protocol', 'MCP'],
			resources: {
				primaryDocumentation: [
					{
						url: 'https://ragflow.io/docs/launch_mcp_server',
					},
				],
			},
		},
		inputs: [],
		outputs: [{ type: NodeConnectionTypes.AiTool, displayName: 'Tools' }],
		credentials,
		properties: [
			getConnectionHintNoticeField([NodeConnectionTypes.AiAgent]),
			{
				displayName: 'Endpoint',
				name: 'endpointUrl',
				type: 'string',
				description: 'Endpoint of your RAGFlow MCP server',
				placeholder: 'e.g. http://10.37.0.21:9382/sse',
				default: DEFAULT_RAGFLOW_MCP_ENDPOINT,
				required: true,
			},
			transportSelect({
				defaultOption: 'sse',
			}),
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						name: 'Bearer Auth',
						value: 'bearerAuth',
					},
					{
						name: 'Header Auth',
						value: 'headerAuth',
					},
					{
						name: 'MCP OAuth2',
						value: 'mcpOAuth2Api',
					},
					{
						name: 'Multiple Headers Auth',
						value: 'multipleHeadersAuth',
					},
					{
						name: 'None',
						value: 'none',
					},
				],
				// Do not preselect auth or a credential; the user must choose both.
				default: 'none',
				description:
					'Choose how to authenticate. For RAGFlow, select Bearer Auth and pick your own credential',
			},
			{
				displayName: 'Credentials',
				name: 'credentials',
				type: 'credentials',
				default: '',
				required: true,
				displayOptions: {
					show: {
						authentication: ['headerAuth', 'bearerAuth', 'mcpOAuth2Api', 'multipleHeadersAuth'],
					},
				},
			},
			{
				displayName: 'Tools to Include',
				name: 'include',
				type: 'options',
				description: 'How to select the tools you want to be exposed to the AI Agent',
				default: 'all',
				options: [
					{
						name: 'All',
						value: 'all',
						description: 'Also include all unchanged fields from the input',
					},
					{
						name: 'Selected',
						value: 'selected',
						description: 'Also include the tools listed in the parameter "Tools to Include"',
					},
					{
						name: 'All Except',
						value: 'except',
						description: 'Exclude the tools listed in the parameter "Tools to Exclude"',
					},
				],
			},
			{
				displayName: 'Tools to Include',
				name: 'includeTools',
				type: 'multiOptions',
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: {
					loadOptionsMethod: 'getTools',
					loadOptionsDependsOn: ['endpointUrl'],
				},
				displayOptions: {
					show: {
						include: ['selected'],
					},
				},
			},
			{
				displayName: 'Tools to Exclude',
				name: 'excludeTools',
				type: 'multiOptions',
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: {
					loadOptionsMethod: 'getTools',
				},
				displayOptions: {
					show: {
						include: ['except'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				placeholder: 'Add Option',
				description: 'Additional options to add',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Timeout',
						name: 'timeout',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 60000,
						description: 'Time in ms to wait for tool calls to finish',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			getTools,
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		return await buildMcpToolkit(this, itemIndex, resolveConfigFromNodeParameters(this, itemIndex));
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeMcpTool(
			this,
			(itemIndex) => resolveConfigFromNodeParameters(this, itemIndex),
			{
				enableSessionCache: true,
			},
		);
	}
}
