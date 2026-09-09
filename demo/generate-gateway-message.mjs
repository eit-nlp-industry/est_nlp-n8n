#!/usr/bin/env node
/**
 * Offline: generate the Gateway wire message that smallbrain-mcp-server.mjs
 * would POST to SMALL_BRAIN_GATEWAY_URL (/v1/tasks). No network required.
 *
 * Usage:
 *   node demo/generate-gateway-message.mjs return_and_rest
 *   node demo/generate-gateway-message.mjs navigate --query 110实验室
 *   node demo/generate-gateway-message.mjs knock_and_return --door_anchor 110实验室
 *   node demo/generate-gateway-message.mjs asset_check_at --inspection_anchor 110实验室 --object_query 灭火器
 *   node demo/generate-gateway-message.mjs find_and_approach_at --search_anchor 110实验室 --object_query 灭火器
 *
 * Env:
 *   SMALL_BRAIN_GATEWAY_URL   default http://10.40.17.16:8001
 *   SMALL_BRAIN_GATEWAY_TOKEN / SMALL_BRAIN_TOKEN  Bearer for Authorization header
 *   SMALL_BRAIN_MCP_CLIENT_NAMESPACE  default brain (affects deterministic task_id)
 *   REQUEST_ID                optional idempotency key for stable task_id
 */

import { createHash, randomUUID } from 'node:crypto';

const GATEWAY_URL = (process.env.SMALL_BRAIN_GATEWAY_URL || 'http://10.40.17.16:8001').replace(
	/\/$/,
	'',
);
const CLIENT_NAMESPACE = process.env.SMALL_BRAIN_MCP_CLIENT_NAMESPACE || 'brain';
const SKILL_VERSION = '1';

const ROBOT_TOOLS = new Set([
	'navigate',
	'knock_door',
	'find_object',
	'approach_object',
	'follow_person',
	'sit',
	'lie_down',
	'stand_up',
	'wait',
	'perform_action',
]);

const NAMED_SKILLS = new Set([
	'handoff_delivery',
	'knock_and_return',
	'find_and_approach_at',
	'return_and_rest',
	'asset_check_at',
	'finite_patrol',
]);

function taskIdFor(idempotencyKey) {
	if (!idempotencyKey) {
		return `mcp:req:${randomUUID().replace(/-/g, '').slice(0, 24)}`;
	}
	const digest = createHash('sha256')
		.update(`${CLIENT_NAMESPACE}\n${idempotencyKey}`, 'utf8')
		.digest('hex')
		.slice(0, 32);
	return `mcp:req:${digest}`;
}

function parseArgs(argv) {
	const [name, ...rest] = argv;
	const params = {};
	for (let i = 0; i < rest.length; i++) {
		const token = rest[i];
		if (!token.startsWith('--')) continue;
		const key = token.slice(2);
		const next = rest[i + 1];
		if (!next || next.startsWith('--')) {
			params[key] = true;
			continue;
		}
		i += 1;
		if (key === 'via_anchors' || key === 'anchors') {
			params[key] = next.split(',').map((s) => s.trim()).filter(Boolean);
		} else if (key === 'timeout_s' || key === 'duration_s') {
			params[key] = Number(next);
		} else {
			params[key] = next;
		}
	}
	return { name, params };
}

function defaultParams(name) {
	switch (name) {
		case 'return_and_rest':
			return { rest_anchor: '起点' };
		case 'navigate':
			return { query: '起点' };
		case 'knock_and_return':
			return { door_anchor: '110实验室' };
		case 'asset_check_at':
			return { inspection_anchor: '110实验室', object_query: '灭火器' };
		case 'find_and_approach_at':
			return { search_anchor: '110实验室', object_query: '灭火器' };
		case 'sit':
		case 'lie_down':
		case 'stand_up':
			return {};
		default:
			return {};
	}
}

const { name, params: cliParams } = parseArgs(process.argv.slice(2));
if (!name || name === '-h' || name === '--help') {
	console.error(`Usage: node demo/generate-gateway-message.mjs <tool|skill> [--param value ...]
Gateway target (documentation only): ${GATEWAY_URL}/v1/tasks`);
	process.exit(name ? 0 : 1);
}

if (!ROBOT_TOOLS.has(name) && !NAMED_SKILLS.has(name)) {
	console.error(`Unknown capability: ${name}`);
	process.exit(1);
}

const params = { ...defaultParams(name), ...cliParams };
const requestId = process.env.REQUEST_ID || null;
const taskId = taskIdFor(requestId);
const body = ROBOT_TOOLS.has(name)
	? { task_id: taskId, tool: name, params }
	: { task_id: taskId, skill: name, skill_version: SKILL_VERSION, params };

const gatewayToken =
	process.env.SMALL_BRAIN_GATEWAY_TOKEN || process.env.SMALL_BRAIN_TOKEN || '';
const envelope = {
	method: 'POST',
	url: `${GATEWAY_URL}/v1/tasks`,
	headers: {
		'Content-Type': 'application/json; charset=utf-8',
		Authorization: gatewayToken
			? `Bearer ${gatewayToken}`
			: 'Bearer <SMALL_BRAIN_TOKEN>',
	},
	body,
	notes: {
		source: 'offline generate-gateway-message.mjs (same shape as smallbrain-mcp-server tools/call)',
		anchor_note:
			'Anchors are passed through as typed; live adapter may rewrite aliases via Atlas when SMALL_BRAIN_ATLAS_PATH is set.',
		demo_scope:
			'Near-term demo: prefer navigate / knock_and_return / asset_check_at / find_and_approach_at for position tasks. return_and_rest is deferred-rest policy — robot team said not for real-dog demo yet.',
	},
};

console.log(JSON.stringify(envelope, null, 2));
