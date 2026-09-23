/**
 * Mock MCP for brain ↔ small-brain registry (BRAIN_SMALLBRAIN_REGISTRY_REVIEW_V1).
 *
 * Capability surface owned by "robot team":
 *   - 10 Robot Tools
 *   - 6 named Skills (SOP + anchor/recovery stay server-side)
 *   - 1 Control Tool (x5_stream) + patrol_stop helper
 *
 * Agent should discover tools via MCP list_tools; do not hardcode the catalog
 * in Agent instructions.
 *
 *   node demo/mock-mcp-server.mjs
 *   $env:MOCK_MCP_PORT=3921; node demo/mock-mcp-server.mjs
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../packages/cli/package.json'));

const { Server: McpServer } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const HOST = process.env.MOCK_MCP_HOST || '0.0.0.0';
const PORT = Number(process.env.MOCK_MCP_PORT || 3921);
const PATHNAME = '/mcp';
const SKILL_VERSION = '1';

/** @type {Map<string, object>} */
const tasks = new Map();

function newTaskId(kind) {
	return `mock:${kind}:${randomUUID().slice(0, 8)}`;
}

function textResult(payload) {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function storeTask(record) {
	tasks.set(record.task_id, record);
	return record;
}

function acceptRobotTool(tool, params, extra = {}) {
	const task_id = newTaskId(tool);
	const record = {
		mock: true,
		kind: 'robot_tool',
		task_id,
		tool,
		params,
		status: 'succeeded',
		success: true,
		last_reached_anchor: null,
		recovery: null,
		observation: extra.observation ?? `mock robot tool ${tool} succeeded`,
		result: extra.result ?? {},
		steps: [{ step_id: 's1', tool, status: 'succeeded', params }],
	};
	return textResult(storeTask(record));
}

function acceptSkill(skill, params, { status = 'succeeded', observation, result, recovery, last_reached_anchor, steps } = {}) {
	const task_id = newTaskId(skill);
	const record = {
		mock: true,
		kind: 'skill',
		task_id,
		skill,
		skill_version: SKILL_VERSION,
		params,
		status,
		success: status === 'succeeded' || status === 'accepted' || status === 'running' || status === 'resting',
		last_reached_anchor: last_reached_anchor ?? null,
		recovery: recovery ?? null,
		observation: observation ?? `mock skill ${skill} -> ${status}`,
		result: result ?? {},
		steps: steps ?? [],
	};
	return textResult(storeTask(record));
}

function missing(fields) {
	return textResult({
		mock: true,
		success: false,
		status: 'rejected',
		error: { code: 'invalid_params', message: `missing required: ${fields.join(', ')}` },
	});
}

// —— MCP tool catalog (self-describing; Agent reads these, not a hardcoded prompt list) ——

const TOOLS = [
	// Robot Tools
	{
		name: 'navigate',
		description:
			'Robot Tool. Navigate via Atlas text query (single place, ordered places, or navigation phrase). Brain sends semantic Anchor/query only — never pose/path/atlas overrides. Prefer this over any return_home alias.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Non-empty place/query text, max 500 chars' },
				timeout_s: { type: 'number', description: 'Optional 1..86400, default 3600' },
			},
			required: ['query'],
		},
	},
	{
		name: 'knock_door',
		description:
			'Robot Tool. Search/confirm door at CURRENT location and approach; may greet/Hello knock when approach_only=false. Does NOT navigate back. For knock-then-return use Skill knock_and_return.',
		inputSchema: {
			type: 'object',
			properties: {
				approach_only: { type: 'boolean', description: 'Default false' },
				search_mode: {
					type: 'string',
					enum: ['candidate_only', 'fixed_45_sweep'],
					description: 'Door search mode',
				},
				timeout_s: { type: 'number', description: 'Optional 1..900, default 180' },
			},
		},
	},
	{
		name: 'find_object',
		description:
			'Robot Tool. Limited local search in CURRENT area only (not cross-floor). query required unless target_id given. For go-to-anchor-then-find prefer Skill find_and_approach_at.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Object text, max 120; required if no target_id' },
				target_id: { type: 'string', description: 'Short-lived confirmed target ref' },
				approach_after_find: { type: 'boolean', description: 'Default false' },
				timeout_s: { type: 'number' },
				search_radius_m: { type: 'number' },
				standoff_m: { type: 'number' },
				bearing_deg: { type: 'number' },
				bearing_tolerance_deg: {
					type: 'number',
					description: 'Only with bearing_deg',
				},
			},
		},
	},
	{
		name: 'approach_object',
		description:
			'Robot Tool. Approach an already confirmed near-field target_id from a prior find. Prefer find_object(approach_after_find=true) or Skill find_and_approach_at for one-shot flows.',
		inputSchema: {
			type: 'object',
			properties: {
				target_id: { type: 'string' },
				query: { type: 'string' },
				timeout_s: { type: 'number' },
				search_radius_m: { type: 'number' },
				standoff_m: { type: 'number' },
			},
			required: ['target_id'],
		},
	},
	{
		name: 'follow_person',
		description:
			'Robot Tool. Enroll ~9s then continuously follow a person. until=cancelled must be stopped via cancel; do not send duration/timeouts in cancelled mode.',
		inputSchema: {
			type: 'object',
			properties: {
				target: { type: 'string', description: 'Default person' },
				enrollment_s: { type: 'number', description: 'If set must be 9.0' },
				bearing_deg: { type: 'number' },
				until: {
					type: 'string',
					enum: ['duration', 'cancel_or_timeout', 'cancelled'],
				},
				duration_s: { type: 'number', description: 'Required when until=duration' },
				max_duration_s: { type: 'number' },
				timeout_s: { type: 'number' },
			},
		},
	},
	{
		name: 'sit',
		description: 'Robot Tool. Sit in place.',
		inputSchema: {
			type: 'object',
			properties: { timeout_s: { type: 'number' } },
		},
	},
	{
		name: 'lie_down',
		description: 'Robot Tool. Lie down in place.',
		inputSchema: {
			type: 'object',
			properties: { timeout_s: { type: 'number' } },
		},
	},
	{
		name: 'stand_up',
		description: 'Robot Tool. Stand up in place.',
		inputSchema: {
			type: 'object',
			properties: { timeout_s: { type: 'number' } },
		},
	},
	{
		name: 'wait',
		description: 'Robot Tool. Wait at current location. Prefer omitting timeout_s and let small-brain normalize.',
		inputSchema: {
			type: 'object',
			properties: {
				duration_s: { type: 'number', description: '0..3600, default 0' },
				timeout_s: { type: 'number' },
			},
		},
	},
	{
		name: 'perform_action',
		description:
			'Robot Tool. Whitelist Unitree gesture only: greet, stretch, heart, new_year_greeting, scrape, dance1, dance2. Never call commissioning-only flips/jumps.',
		inputSchema: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: ['greet', 'stretch', 'heart', 'new_year_greeting', 'scrape', 'dance1', 'dance2'],
				},
				duration_s: { type: 'number' },
				timeout_s: { type: 'number' },
			},
			required: ['action'],
		},
	},

	// Named Skills — server expands SOP; brain must NOT re-expand into atoms
	{
		name: 'handoff_delivery',
		description:
			'Named Skill v1 (aliases: 取外卖/取快递/人工交接配送). Server expands: navigate(pickup)->lie_down->wait(20s)->stand_up->navigate(dropoff). No grasp sensors. Prefer this over hand-written steps for delivery.',
		inputSchema: {
			type: 'object',
			properties: {
				pickup_anchor: { type: 'string', description: 'Required Atlas Anchor' },
				dropoff_anchor: { type: 'string', description: 'Required Atlas Anchor' },
			},
			required: ['pickup_anchor', 'dropoff_anchor'],
		},
	},
	{
		name: 'knock_and_return',
		description:
			'Named Skill v1 (敲门并返回). Expands: [navigate(via)...]->navigate(door)->knock_door(fixed_45_sweep)->fresh navigate(door). Whitelist business failures may auto navigate(last_reached_anchor) once; top-level status stays failed; see recovery.status. Prefer over knock_door alone when return is required.',
		inputSchema: {
			type: 'object',
			properties: {
				door_anchor: { type: 'string' },
				via_anchors: { type: 'array', items: { type: 'string' } },
			},
			required: ['door_anchor'],
		},
	},
	{
		name: 'find_and_approach_at',
		description:
			'Named Skill v1 (定点寻物并靠近). Expands: navigate(search_anchor)->find_object(query, approach_after_find=true). Stays near object; deferred return to search_anchor may be inserted before the next FIFO business task by gateway.',
		inputSchema: {
			type: 'object',
			properties: {
				search_anchor: { type: 'string' },
				object_query: { type: 'string', description: 'Max 120 chars' },
			},
			required: ['search_anchor', 'object_query'],
		},
	},
	{
		name: 'return_and_rest',
		description:
			'Named Skill v1 (回点休息). Deferred-rest policy: after ~30s idle FIFO, navigate(rest_anchor) then lie_down if still idle. status resting means policy active, not a one-shot terminal. Only one may exist. Default rest_anchor=起点.',
		inputSchema: {
			type: 'object',
			properties: {
				rest_anchor: { type: 'string', description: 'Optional, default 起点' },
			},
		},
	},
	{
		name: 'asset_check_at',
		description:
			'Named Skill v1 (单点资产核验). Expands: navigate(inspection_anchor)->find_object(approach_after_find=false)->fresh navigate(inspection_anchor). Presence check only — no counting/DB. Not-found => failed; whitelist recovery may return to anchor without flipping to succeeded.',
		inputSchema: {
			type: 'object',
			properties: {
				inspection_anchor: { type: 'string' },
				object_query: { type: 'string' },
			},
			required: ['inspection_anchor', 'object_query'],
		},
	},
	{
		name: 'finite_patrol',
		description:
			'Named Skill v1. Despite the name, this is CONTINUOUS loop patrol along anchors until patrol_stop. Holds FIFO head; no X5. Do NOT use ordinary cancel. Do NOT treat return_anchor as post-stop home (mock ignores return_anchor as stop target).',
		inputSchema: {
			type: 'object',
			properties: {
				anchors: {
					type: 'array',
					items: { type: 'string' },
					description: 'Required non-empty; duplicates kept',
				},
				return_anchor: {
					type: 'string',
					description: 'Deprecated semantics: becomes another loop point, not stop-home',
				},
			},
			required: ['anchors'],
		},
	},

	// Control / helpers (not robot FIFO tools, but brain-callable)
	{
		name: 'patrol_stop',
		description:
			'Control helper for finite_patrol. Stops after current navigate leg reaches its Anchor. Required instead of cancel for patrol tasks.',
		inputSchema: {
			type: 'object',
			properties: {
				task_id: { type: 'string' },
				reason: { type: 'string', description: 'e.g. brain_requested' },
			},
			required: ['task_id'],
		},
	},
	{
		name: 'x5_stream',
		description:
			'Control Tool (NOT robot FIFO). Explicit X5 session start|status|stop only. Ordinary knock/find/follow manage X5 themselves — do not open this first. Frames are NOT fetched here.',
		inputSchema: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: ['start', 'status', 'stop'] },
				session_id: { type: 'string', description: 'Required for all actions in brain registry' },
			},
			required: ['action', 'session_id'],
		},
	},
	{
		name: 'get_task_status',
		description:
			'Query mock task by task_id. Brain must use top-level task status, not a single step/waypoint success.',
		inputSchema: {
			type: 'object',
			properties: { task_id: { type: 'string' } },
			required: ['task_id'],
		},
	},
];

function handleTool(name, args = {}) {
	switch (name) {
		case 'navigate': {
			if (!String(args.query || '').trim()) return missing(['query']);
			return acceptRobotTool('navigate', args, {
				observation: `Arrived semantic goal for query=${args.query} (mock)`,
				result: { query: args.query },
			});
		}
		case 'knock_door':
			return acceptRobotTool('knock_door', args, {
				observation: 'Door interaction completed at current pose (mock)',
			});
		case 'find_object': {
			if (!args.target_id && !String(args.query || '').trim()) return missing(['query|target_id']);
			const target_id = args.target_id || `obj-${randomUUID().slice(0, 8)}`;
			return acceptRobotTool('find_object', args, {
				observation: `Local search found target_id=${target_id} (mock)`,
				result: { target_id, query: args.query ?? null },
			});
		}
		case 'approach_object': {
			if (!args.target_id) return missing(['target_id']);
			return acceptRobotTool('approach_object', args, {
				observation: `Approached ${args.target_id} (mock)`,
			});
		}
		case 'follow_person':
			return acceptRobotTool('follow_person', args, {
				observation: `Follow person started/finished per until=${args.until || 'cancel_or_timeout'} (mock)`,
			});
		case 'sit':
		case 'lie_down':
		case 'stand_up':
			return acceptRobotTool(name, args);
		case 'wait':
			return acceptRobotTool('wait', args, {
				observation: `Waited ${args.duration_s ?? 0}s (mock)`,
			});
		case 'perform_action': {
			if (!args.action) return missing(['action']);
			const allowed = new Set([
				'greet',
				'stretch',
				'heart',
				'new_year_greeting',
				'scrape',
				'dance1',
				'dance2',
			]);
			const action = String(args.action).toLowerCase();
			if (!allowed.has(action)) {
				return textResult({
					mock: true,
					success: false,
					status: 'rejected',
					error: { code: '422', message: `action not enabled in production: ${action}` },
				});
			}
			return acceptRobotTool('perform_action', { ...args, action });
		}

		case 'handoff_delivery': {
			if (!args.pickup_anchor || !args.dropoff_anchor) {
				return missing(['pickup_anchor', 'dropoff_anchor']);
			}
			return acceptSkill('handoff_delivery', args, {
				last_reached_anchor: args.dropoff_anchor,
				observation: `Delivery mock: stood at ${args.dropoff_anchor}`,
				steps: [
					{ tool: 'navigate', params: { query: args.pickup_anchor }, status: 'succeeded' },
					{ tool: 'lie_down', status: 'succeeded' },
					{ tool: 'wait', params: { duration_s: 20 }, status: 'succeeded' },
					{ tool: 'stand_up', status: 'succeeded' },
					{ tool: 'navigate', params: { query: args.dropoff_anchor }, status: 'succeeded' },
				],
			});
		}
		case 'knock_and_return': {
			if (!args.door_anchor) return missing(['door_anchor']);
			const via = Array.isArray(args.via_anchors) ? args.via_anchors : [];
			const forceFail = String(args.door_anchor).includes('失败') || args.mock_fail === true;
			if (forceFail) {
				const last = via[via.length - 1] || '起点';
				return acceptSkill('knock_and_return', args, {
					status: 'failed',
					last_reached_anchor: last,
					recovery: { status: 'succeeded', action: 'navigate', query: last },
					observation: 'Door not found (mock business failure); recovered to last_reached_anchor',
					steps: [
						...via.map((a) => ({ tool: 'navigate', params: { query: a }, status: 'succeeded' })),
						{ tool: 'navigate', params: { query: args.door_anchor }, status: 'succeeded' },
						{ tool: 'knock_door', status: 'failed', error: 'door_not_found' },
						{ tool: 'navigate', params: { query: last }, status: 'succeeded', recovery: true },
					],
				});
			}
			return acceptSkill('knock_and_return', args, {
				last_reached_anchor: args.door_anchor,
				steps: [
					...via.map((a) => ({ tool: 'navigate', params: { query: a }, status: 'succeeded' })),
					{ tool: 'navigate', params: { query: args.door_anchor }, status: 'succeeded' },
					{ tool: 'knock_door', params: { search_mode: 'fixed_45_sweep' }, status: 'succeeded' },
					{ tool: 'navigate', params: { query: args.door_anchor }, status: 'succeeded' },
				],
			});
		}
		case 'find_and_approach_at': {
			if (!args.search_anchor || !args.object_query) {
				return missing(['search_anchor', 'object_query']);
			}
			const target_id = `obj-${randomUUID().slice(0, 8)}`;
			return acceptSkill('find_and_approach_at', args, {
				last_reached_anchor: args.search_anchor,
				result: { target_id },
				observation: `Found and approached near ${args.search_anchor}; deferred return may apply later (mock)`,
				steps: [
					{ tool: 'navigate', params: { query: args.search_anchor }, status: 'succeeded' },
					{
						tool: 'find_object',
						params: { query: args.object_query, approach_after_find: true },
						status: 'succeeded',
						result: { target_id },
					},
				],
			});
		}
		case 'return_and_rest': {
			const rest_anchor = args.rest_anchor || '起点';
			return acceptSkill(
				'return_and_rest',
				{ rest_anchor },
				{
					status: 'resting',
					last_reached_anchor: rest_anchor,
					observation: `Deferred-rest policy armed at ${rest_anchor} (mock resting)`,
					steps: [
						{ tool: 'navigate', params: { query: rest_anchor }, status: 'succeeded' },
						{ tool: 'lie_down', status: 'succeeded' },
					],
				},
			);
		}
		case 'asset_check_at': {
			if (!args.inspection_anchor || !args.object_query) {
				return missing(['inspection_anchor', 'object_query']);
			}
			const notFound = String(args.object_query).includes('没有') || args.mock_fail === true;
			if (notFound) {
				return acceptSkill('asset_check_at', args, {
					status: 'failed',
					last_reached_anchor: args.inspection_anchor,
					recovery: {
						status: 'succeeded',
						action: 'navigate',
						query: args.inspection_anchor,
					},
					observation: 'Object not found in local area (mock); recovered to inspection_anchor',
					result: { found: false },
				});
			}
			return acceptSkill('asset_check_at', args, {
				last_reached_anchor: args.inspection_anchor,
				result: { found: true },
				steps: [
					{ tool: 'navigate', params: { query: args.inspection_anchor }, status: 'succeeded' },
					{
						tool: 'find_object',
						params: { query: args.object_query, approach_after_find: false },
						status: 'succeeded',
					},
					{ tool: 'navigate', params: { query: args.inspection_anchor }, status: 'succeeded' },
				],
			});
		}
		case 'finite_patrol': {
			if (!Array.isArray(args.anchors) || args.anchors.length === 0) return missing(['anchors']);
			const task_id = newTaskId('finite_patrol');
			const record = {
				mock: true,
				kind: 'skill',
				task_id,
				skill: 'finite_patrol',
				skill_version: SKILL_VERSION,
				params: args,
				status: 'running',
				success: true,
				last_reached_anchor: args.anchors[0],
				recovery: null,
				observation: `Continuous patrol accepted; stop with patrol_stop(task_id=${task_id})`,
				result: { loop: args.anchors },
				steps: args.anchors.map((a, i) => ({
					step_id: `p${i}`,
					tool: 'navigate',
					params: { query: a },
					status: i === 0 ? 'succeeded' : 'queued',
				})),
			};
			return textResult(storeTask(record));
		}
		case 'patrol_stop': {
			if (!args.task_id) return missing(['task_id']);
			const existing = tasks.get(args.task_id);
			if (!existing || existing.skill !== 'finite_patrol') {
				return textResult({
					mock: true,
					success: false,
					status: 'rejected',
					error: { message: `no finite_patrol task ${args.task_id}` },
				});
			}
			existing.status = 'succeeded';
			existing.observation = `Patrol stopped after current anchor (reason=${args.reason || 'brain_requested'})`;
			tasks.set(args.task_id, existing);
			return textResult({
				mock: true,
				success: true,
				status: 'succeeded',
				task_id: args.task_id,
				observation: existing.observation,
			});
		}
		case 'x5_stream': {
			if (!args.action || !args.session_id) return missing(['action', 'session_id']);
			return textResult({
				mock: true,
				kind: 'control_tool',
				tool: 'x5_stream',
				success: true,
				status: 'succeeded',
				session_id: args.session_id,
				action: args.action,
				observation: `x5_stream ${args.action} ok (mock); frames via GET not exposed here`,
			});
		}
		case 'get_task_status': {
			if (!args.task_id) return missing(['task_id']);
			const existing = tasks.get(args.task_id);
			if (!existing) {
				return textResult({
					mock: true,
					success: false,
					status: 'rejected',
					error: { message: `unknown task_id ${args.task_id}` },
				});
			}
			return textResult(existing);
		}
		default:
			return {
				isError: true,
				content: [{ type: 'text', text: `Unknown tool: ${name}` }],
			};
	}
}

function createMcpServer() {
	const server = new McpServer(
		{ name: 'smallbrain-mock-mcp', version: 'review.v1' },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: toolArgs = {} } = request.params;
		return handleTool(name, toolArgs);
	});
	return server;
}

function sendJson(res, status, body) {
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'content-type, accept, mcp-session-id, authorization',
		'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	});
	res.end(JSON.stringify(body));
}

const httpServer = createServer(async (req, res) => {
	try {
		const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Headers': 'content-type, accept, mcp-session-id, authorization',
				'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
			});
			res.end();
			return;
		}

		if (req.method === 'GET' && url.pathname === '/health') {
			sendJson(res, 200, {
				ok: true,
				mock: true,
				registry: 'brain.smallbrain.review.v1',
				robot_tools: 10,
				skills: 6,
				control_tools: ['x5_stream', 'patrol_stop', 'get_task_status'],
				mcp: `http://127.0.0.1:${PORT}${PATHNAME}`,
			});
			return;
		}

		if (url.pathname !== PATHNAME) {
			sendJson(res, 404, { error: 'Not found', hint: `Use ${PATHNAME}` });
			return;
		}

		const mcpServer = createMcpServer();
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		await mcpServer.connect(transport);
		await transport.handleRequest(req, res);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!res.headersSent) sendJson(res, 500, { error: message });
	}
});

httpServer.listen(PORT, HOST, () => {
	const localUrl = `http://127.0.0.1:${PORT}${PATHNAME}`;
	console.log(`[mock-mcp] registry=brain.smallbrain.review.v1`);
	console.log(`[mock-mcp] listening on http://${HOST}:${PORT}`);
	console.log(`[mock-mcp] MCP URL: ${localUrl}`);
	console.log(`[mock-mcp] health: http://127.0.0.1:${PORT}/health`);
	console.log(`[mock-mcp] tools exposed: ${TOOLS.length} (10 robot + 6 skills + helpers)`);
	console.log(`[mock-mcp] Docker n8n host URL: http://host.docker.internal:${PORT}${PATHNAME}`);
});
