#!/usr/bin/env node
/**
 * Teach2Nav small-brain production MCP adapter (single-file delivery).
 *
 * This file is the production counterpart of the brain team's
 * `mock-mcp-server.mjs`.  It keeps the same official MCP Streamable HTTP
 * surface, but replaces all mock task records with calls to the deployed
 * small-brain REST Gateway.
 *
 * Runtime prerequisites:
 *   - a Node.js runtime compatible with the brain team's MCP SDK;
 *   - `@modelcontextprotocol/sdk` resolvable from this file, or set
 *     MCP_SDK_PACKAGE_JSON to the brain repository's package.json;
 *   - the existing small-brain Gateway listening on SMALL_BRAIN_GATEWAY_URL.
 *
 * Required production configuration:
 *   SMALL_BRAIN_MCP_TOKEN=<brain-facing bearer token>
 *   SMALL_BRAIN_GATEWAY_TOKEN=<small-brain REST bearer token>
 *
 * Optional configuration:
 *   SMALL_BRAIN_MCP_HOST=0.0.0.0
 *   SMALL_BRAIN_MCP_PORT=8002
 *   SMALL_BRAIN_GATEWAY_URL=http://127.0.0.1:8001
 *   SMALL_BRAIN_MCP_CLIENT_NAMESPACE=brain
 *   SMALL_BRAIN_MCP_POLL_MS=500
 *   SMALL_BRAIN_MCP_MAX_WAIT_MS=7200000
 *   SMALL_BRAIN_MCP_CAPABILITY_TTL_MS=5000
 *   SMALL_BRAIN_ATLAS_PATH=/absolute/path/to/atlas.json
 *   SMALL_BRAIN_MCP_ALLOW_UNAUTHENTICATED=0
 *
 * Idempotent retry:
 *   MCP JSON-RPC `id` is used for tracing only because clients may reuse it
 *   after a response.  For a retry-stable small-brain task_id, supply one
 *   application key in tools/call params._meta.request_id (requestId and
 *   brain/request_id are also accepted).  Reusing that key with different
 *   arguments is rejected by the existing small-brain task-id contract.
 *
 * The adapter does not import ROS, construct navigation paths, expand Skills,
 * publish motion, or own a robot lease.  Those responsibilities remain in the
 * already-tested small-brain Runtime.
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_NAME = 'teach2nav-smallbrain-mcp';
const SERVER_VERSION = '1.1.0';
const REGISTRY_NAME = 'brain.smallbrain.mcp.v1';
const SKILL_VERSION = '1';
const MCP_PATH = '/mcp';

const HOST = process.env.SMALL_BRAIN_MCP_HOST || '0.0.0.0';
const PORT = numberEnv('SMALL_BRAIN_MCP_PORT', 8002, 1, 65535);
const GATEWAY_URL = process.env.SMALL_BRAIN_GATEWAY_URL || 'http://127.0.0.1:8001';
const GATEWAY_TOKEN = process.env.SMALL_BRAIN_GATEWAY_TOKEN || process.env.SMALL_BRAIN_TOKEN || '';
const MCP_TOKEN = process.env.SMALL_BRAIN_MCP_TOKEN || process.env.SMALL_BRAIN_TOKEN || '';
const CLIENT_NAMESPACE = process.env.SMALL_BRAIN_MCP_CLIENT_NAMESPACE || 'brain';
const POLL_MS = numberEnv('SMALL_BRAIN_MCP_POLL_MS', 500, 50, 60000);
const MAX_WAIT_MS = numberEnv('SMALL_BRAIN_MCP_MAX_WAIT_MS', 7200000, 0, 86400000);
const REQUEST_TIMEOUT_MS = numberEnv('SMALL_BRAIN_MCP_REQUEST_TIMEOUT_MS', 15000, 100, 300000);
const CAPABILITY_TTL_MS = numberEnv('SMALL_BRAIN_MCP_CAPABILITY_TTL_MS', 5000, 100, 3600000);
const ALLOW_UNAUTHENTICATED = process.env.SMALL_BRAIN_MCP_ALLOW_UNAUTHENTICATED === '1';

const ROBOT_TOOLS = Object.freeze([
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

const NAMED_SKILLS = Object.freeze([
  'handoff_delivery',
  'knock_and_return',
  'find_and_approach_at',
  'return_and_rest',
  'asset_check_at',
  'finite_patrol',
]);

const CONTROL_TOOLS = Object.freeze([
  'x5_stream',
  'patrol_stop',
  'get_task_status',
]);

const TERMINAL_STATUSES = new Set([
  'succeeded',
  'failed',
  'canceled',
  'rejected',
  'timed_out',
  'interrupted',
]);

const SUCCESS_STATUSES = new Set(['accepted', 'running', 'resting', 'succeeded']);

const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    status: {
      type: 'string',
      enum: [
        'accepted', 'running', 'resting', 'succeeded', 'failed',
        'canceled', 'rejected', 'timed_out', 'interrupted',
      ],
    },
    kind: { type: 'string', enum: ['robot_tool', 'skill', 'control_tool'] },
    task_id: { type: ['string', 'null'] },
    tool: { type: ['string', 'null'] },
    skill: { type: ['string', 'null'] },
    skill_version: { type: ['string', 'null'] },
    params: { type: 'object' },
    last_reached_anchor: { type: ['string', 'null'] },
    recovery: { type: ['object', 'null'] },
    observation: { type: 'string' },
    result: {},
    error: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            retryable: { type: 'boolean' },
            details: {},
          },
          required: ['code', 'message', 'retryable'],
          additionalProperties: true,
        },
      ],
    },
    metadata: { type: 'object' },
    steps: { type: 'array' },
  },
  required: [
    'success', 'status', 'kind', 'task_id', 'tool', 'skill',
    'skill_version', 'params', 'last_reached_anchor', 'recovery',
    'observation', 'result', 'error', 'metadata', 'steps',
  ],
  additionalProperties: false,
});

function numberEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number between ${minimum} and ${maximum}`);
  }
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function objectSchema(properties = {}, required = [], extra = {}) {
  const value = {
    type: 'object',
    properties,
    additionalProperties: false,
    ...extra,
  };
  if (required.length) value.required = required;
  return value;
}

function contract(name, kind, description, inputSchema, options = {}) {
  const fifo = options.fifo !== undefined ? Boolean(options.fifo) : kind !== 'control_tool';
  return {
    name,
    description,
    inputSchema,
    outputSchema: clone(OUTPUT_SCHEMA),
    annotations: {
      readOnlyHint: Boolean(options.readOnly),
      destructiveHint: false,
      idempotentHint: Boolean(options.readOnly),
      openWorldHint: false,
    },
    _meta: {
      'smallbrain/kind': kind,
      'smallbrain/version': options.version || (kind === 'skill' ? SKILL_VERSION : '1'),
      'smallbrain/enabled': true,
      'smallbrain/commissioning_only': false,
      'smallbrain/fifo': fifo,
    },
  };
}

const timeout = (maximum = 86400, defaultValue = undefined) => ({
  type: 'number',
  minimum: 1,
  maximum,
  description: defaultValue === undefined
    ? 'Optional execution timeout in seconds; small-brain normalization applies.'
    : `Optional execution timeout in seconds; default ${defaultValue}.`,
});

const TOOL_CONTRACTS = Object.freeze([
  contract(
    'navigate',
    'robot_tool',
    'Robot Tool. Navigate to one Brain-grounded Atlas Anchor. The Brain resolves fuzzy language and ordered multi-place requests before calling; submit one call per ordered destination. The small brain revalidates the exact canonical name or unambiguous alias. Do NOT send pose, path, atlas, connector, lease, gait, or velocity.',
    objectSchema({
      query: {
        type: 'string', minLength: 1, maxLength: 500,
        description: 'One exact Atlas Anchor canonical name or unambiguous alias; not raw user language.',
      },
      timeout_s: timeout(86400, 3600),
    }, ['query']),
  ),
  contract(
    'knock_door',
    'robot_tool',
    'Robot Tool. At the current area, detect and confirm a door, approach it, and knock when approach_only=false. It does not navigate back. Prefer Named Skill v1 knock_and_return when return is required.',
    objectSchema({
      approach_only: { type: 'boolean', description: 'Default false.' },
      search_mode: {
        type: 'string', enum: ['candidate_only', 'fixed_45_sweep'],
        description: 'Door-search policy.',
      },
      timeout_s: timeout(900, 180),
    }),
  ),
  contract(
    'find_object',
    'robot_tool',
    'Robot Tool. Perform limited local object search in the current area. It does not navigate across scenes. Provide query unless target_id is already known. Prefer Named Skill v1 find_and_approach_at for navigate-then-find behavior.',
    objectSchema({
      query: { type: 'string', minLength: 1, maxLength: 120 },
      target_id: { type: 'string', minLength: 1, maxLength: 160 },
      approach_after_find: { type: 'boolean', description: 'Default false.' },
      timeout_s: timeout(900, 120),
      search_radius_m: { type: 'number', minimum: 0, maximum: 6 },
      standoff_m: { type: 'number', minimum: 0.6, maximum: 3 },
      bearing_deg: { type: 'number', minimum: -180, maximum: 180 },
      bearing_tolerance_deg: { type: 'number', minimum: 5, maximum: 90 },
    }, [], {
      anyOf: [{ required: ['query'] }, { required: ['target_id'] }],
      dependentRequired: { bearing_tolerance_deg: ['bearing_deg'] },
    }),
  ),
  contract(
    'approach_object',
    'robot_tool',
    'Robot Tool. Approach a previously confirmed near-field target_id. It does not perform semantic navigation. Prefer find_object with approach_after_find=true or Named Skill v1 find_and_approach_at for a one-call flow.',
    objectSchema({
      target_id: { type: 'string', minLength: 1, maxLength: 160 },
      query: { type: 'string', maxLength: 120 },
      timeout_s: timeout(900, 120),
      search_radius_m: { type: 'number', minimum: 0, maximum: 6 },
      standoff_m: { type: 'number', minimum: 0.6, maximum: 3 },
    }, ['target_id']),
  ),
  contract(
    'follow_person',
    'robot_tool',
    'Robot Tool. Enroll and follow one person. until=duration requires duration_s; until=cancelled is long-running and returns a task_id for later status or cancellation. Visual sensing and motion remain small-brain owned.',
    objectSchema({
      target: { type: 'string', maxLength: 160, description: 'Default person.' },
      enrollment_s: { type: 'number', enum: [9.0] },
      bearing_deg: { type: 'number', minimum: -180, maximum: 180 },
      until: { type: 'string', enum: ['duration', 'cancel_or_timeout', 'cancelled'] },
      duration_s: { type: 'number', minimum: 1, maximum: 3600 },
      max_duration_s: { type: 'number', minimum: 1, maximum: 3600 },
      timeout_s: timeout(3660),
    }, [], {
      allOf: [
        {
          if: { properties: { until: { const: 'duration' } }, required: ['until'] },
          then: { required: ['duration_s'] },
        },
        {
          if: { properties: { until: { const: 'cancelled' } }, required: ['until'] },
          then: {
            not: {
              anyOf: [
                { required: ['duration_s'] },
                { required: ['max_duration_s'] },
                { required: ['timeout_s'] },
              ],
            },
          },
        },
      ],
    }),
  ),
  contract('sit', 'robot_tool', 'Robot Tool. Sit in place.', objectSchema({ timeout_s: timeout(120, 30) })),
  contract('lie_down', 'robot_tool', 'Robot Tool. Lie down in place.', objectSchema({ timeout_s: timeout(120, 30) })),
  contract('stand_up', 'robot_tool', 'Robot Tool. Stand up in place.', objectSchema({ timeout_s: timeout(120, 30) })),
  contract(
    'wait',
    'robot_tool',
    'Robot Tool. Wait at the current location without navigation.',
    objectSchema({
      duration_s: { type: 'number', minimum: 0, maximum: 3600 },
      timeout_s: timeout(3660),
    }),
  ),
  contract(
    'perform_action',
    'robot_tool',
    'Robot Tool. Execute one production-whitelisted Unitree gesture. Commissioning-only flips and jumps are never exposed.',
    objectSchema({
      action: {
        type: 'string',
        enum: ['greet', 'stretch', 'heart', 'new_year_greeting', 'scrape', 'dance1', 'dance2'],
      },
      duration_s: { type: 'number', minimum: 1, maximum: 30 },
      timeout_s: timeout(180, 60),
    }, ['action']),
  ),

  contract(
    'handoff_delivery',
    'skill',
    'Named Skill v1 (aliases: 取外卖, 取快递, 人工交接配送). Server expands the complete pickup-wait-delivery SOP; call once and do not expand it into atomic Tools. Runtime Anchor state and recovery remain small-brain owned.',
    objectSchema({
      pickup_anchor: { type: 'string', minLength: 1, description: 'Exact Atlas Anchor.' },
      dropoff_anchor: { type: 'string', minLength: 1, description: 'Exact Atlas Anchor.' },
    }, ['pickup_anchor', 'dropoff_anchor']),
  ),
  contract(
    'knock_and_return',
    'skill',
    'Named Skill v1 (alias: 敲门并返回). Server navigates through optional via Anchors, navigates to the door Anchor, executes knock_door, then issues a fresh navigation back to that Anchor. Call once; do not expand the SOP in the Brain.',
    objectSchema({
      door_anchor: { type: 'string', minLength: 1, description: 'Exact Atlas Anchor.' },
      via_anchors: {
        type: 'array', items: { type: 'string', minLength: 1 },
        description: 'Optional ordered exact Atlas Anchors.',
      },
    }, ['door_anchor']),
  ),
  contract(
    'find_and_approach_at',
    'skill',
    'Named Skill v1 (alias: 定点寻物并靠近). Server navigates to search_anchor, searches for object_query, and approaches the confirmed object. It remains near the object; later Anchor recovery is small-brain owned.',
    objectSchema({
      search_anchor: { type: 'string', minLength: 1 },
      object_query: { type: 'string', minLength: 1, maxLength: 120 },
    }, ['search_anchor', 'object_query']),
  ),
  contract(
    'return_and_rest',
    'skill',
    'Named Skill v1 (alias: 回点休息). Arm the small-brain deferred-rest policy. After the FIFO stays idle, navigate to rest_anchor and lie down. The policy is not an ordinary one-shot navigation task.',
    objectSchema({ rest_anchor: { type: 'string', minLength: 1, description: 'Default 起点.' } }),
  ),
  contract(
    'asset_check_at',
    'skill',
    'Named Skill v1 (alias: 单点资产核验). Server navigates to inspection_anchor, checks object presence without approach, and navigates back to the inspection Anchor. This is presence checking, not inventory counting.',
    objectSchema({
      inspection_anchor: { type: 'string', minLength: 1 },
      object_query: { type: 'string', minLength: 1, maxLength: 120 },
    }, ['inspection_anchor', 'object_query']),
  ),
  contract(
    'finite_patrol',
    'skill',
    'Named Skill v1 (alias: 定点巡航). Continuously patrol the ordered Anchor list until patrol_stop is called. It holds the FIFO head, preserves duplicate Anchors, and does not use X5. Do not use ordinary cancel for a normal patrol stop.',
    objectSchema({
      anchors: {
        type: 'array', minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
      return_anchor: {
        type: 'string', minLength: 1,
        description: 'Legacy field: appended to the loop; not a post-stop home target.',
      },
    }, ['anchors']),
  ),

  contract(
    'x5_stream',
    'control_tool',
    'Control Tool. Start, inspect, or stop one explicit Brain-owned X5 session. It does not enter the robot FIFO. Ordinary knock, find, and follow tasks manage X5 themselves; do not open an external session first.',
    objectSchema({
      action: { type: 'string', enum: ['start', 'status', 'stop'] },
      session_id: { type: 'string', minLength: 1, maxLength: 160 },
    }, ['action', 'session_id']),
    { fifo: false },
  ),
  contract(
    'patrol_stop',
    'control_tool',
    'Control helper. Ask a finite_patrol task to stop after its current navigation leg reaches an Anchor. It does not enter the FIFO and is not ordinary cancellation.',
    objectSchema({
      task_id: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
      reason: { type: 'string', maxLength: 240 },
    }, ['task_id']),
    { fifo: false },
  ),
  contract(
    'get_task_status',
    'control_tool',
    'Control helper. Return the authoritative top-level small-brain task status. Do not infer completion from a step, waypoint, or motion event.',
    objectSchema({
      task_id: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
    }, ['task_id']),
    { fifo: false, readOnly: true },
  ),
]);

const CONTRACT_BY_NAME = new Map(TOOL_CONTRACTS.map((item) => [item.name, item]));

class AdapterError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'AdapterError';
    this.code = String(code || 'adapter_error');
    this.httpStatus = Number(options.httpStatus || 0);
    this.retryable = options.retryable !== undefined
      ? Boolean(options.retryable)
      : retryableCode(this.code, this.httpStatus);
    this.details = options.details;
  }
}

function retryableCode(code, httpStatus = 0) {
  if (httpStatus >= 500 || httpStatus === 408 || httpStatus === 429) return true;
  const value = String(code || '').toLowerCase();
  return [
    'timeout', 'temporarily', 'unavailable', 'busy', 'connection',
    'backend_not_ready', 'waiting_', 'transport',
  ].some((fragment) => value.includes(fragment));
}

function errorObject(error, fallback = 'smallbrain_error') {
  if (error instanceof AdapterError) {
    const value = {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
    if (error.details !== undefined) value.details = error.details;
    return value;
  }
  if (error && typeof error === 'object') {
    const code = String(error.code || fallback);
    const message = String(error.message || JSON.stringify(error));
    const value = {
      code,
      message,
      retryable: error.retryable !== undefined
        ? Boolean(error.retryable)
        : retryableCode(code),
    };
    if (error.details !== undefined) value.details = error.details;
    return value;
  }
  return {
    code: fallback,
    message: String(error || fallback),
    retryable: retryableCode(fallback),
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gatewayRequest(method, resourcePath, payload = undefined, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const target = new URL(resourcePath, `${GATEWAY_URL.replace(/\/$/, '')}/`);
    const transport = target.protocol === 'https:' ? https : http;
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload), 'utf8');
    const headers = { Accept: 'application/json' };
    if (body) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = String(body.length);
    }
    if (GATEWAY_TOKEN) headers.Authorization = `Bearer ${GATEWAY_TOKEN}`;

    const request = transport.request(target, { method, headers }, (response) => {
      const chunks = [];
      let length = 0;
      response.on('data', (chunk) => {
        length += chunk.length;
        if (length <= 8 * 1024 * 1024) chunks.push(chunk);
      });
      response.on('end', () => {
        if (length > 8 * 1024 * 1024) {
          reject(new AdapterError('invalid_smallbrain_response', 'small-brain JSON response is too large'));
          return;
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = {};
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch (cause) {
            reject(new AdapterError(
              'invalid_smallbrain_response',
              'small-brain Gateway returned non-JSON data',
              { httpStatus: response.statusCode || 0, details: raw.slice(0, 500) },
            ));
            return;
          }
        }
        const status = Number(response.statusCode || 0);
        if (status < 200 || status >= 300) {
          const native = parsed && parsed.error;
          const code = native && typeof native === 'object'
            ? native.code || `smallbrain_http_${status}`
            : `smallbrain_http_${status}`;
          const message = native && typeof native === 'object'
            ? native.message || JSON.stringify(native)
            : raw || `small-brain HTTP ${status}`;
          reject(new AdapterError(code, message, {
            httpStatus: status,
            retryable: native && typeof native === 'object' && native.retryable !== undefined
              ? Boolean(native.retryable)
              : undefined,
            details: native && typeof native === 'object' ? native.details : undefined,
          }));
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new AdapterError('invalid_smallbrain_response', 'small-brain response must be a JSON object'));
          return;
        }
        resolve(parsed);
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new AdapterError(
        'smallbrain_gateway_timeout',
        `small-brain Gateway did not respond within ${timeoutMs} ms`,
        { retryable: true },
      ));
    });
    request.on('error', (cause) => {
      if (cause instanceof AdapterError) reject(cause);
      else reject(new AdapterError('smallbrain_gateway_unavailable', String(cause.message || cause), {
        retryable: true,
      }));
    });
    if (body) request.write(body);
    request.end();
  });
}

let capabilityCache = null;
let capabilityCacheAt = 0;

async function getCapabilities(options = {}) {
  const now = Date.now();
  if (!options.force && capabilityCache && now - capabilityCacheAt < CAPABILITY_TTL_MS) {
    return capabilityCache;
  }
  try {
    const value = await gatewayRequest('GET', '/v1/capabilities');
    capabilityCache = value;
    capabilityCacheAt = now;
    return value;
  } catch (error) {
    if (capabilityCache) return capabilityCache;
    if (options.required) throw error;
    return null;
  }
}

function capabilityAllows(name, kind, capabilities) {
  if (!capabilities) return true;
  if (kind === 'robot_tool') {
    const item = capabilities.tools && capabilities.tools[name];
    return Boolean(item && item.available !== false);
  }
  if (kind === 'skill') {
    const skills = capabilities.skill_catalogue && capabilities.skill_catalogue.skills;
    return Boolean(skills && skills[name]);
  }
  if (name === 'x5_stream') {
    const item = capabilities.control_tools && capabilities.control_tools.x5_stream;
    return Boolean(item && item.available !== false);
  }
  if (name === 'patrol_stop') return capabilities.stop_patrol !== false;
  if (name === 'get_task_status') return capabilities.task_queue !== false;
  return false;
}

function dynamicTool(contractValue, capabilities) {
  const value = clone(contractValue);
  const kind = value._meta['smallbrain/kind'];
  value._meta['smallbrain/capability_source'] = capabilities
    ? String(capabilities.schema || REGISTRY_NAME)
    : 'safe_contract_fallback';

  if (kind === 'skill' && capabilities && capabilities.skill_catalogue) {
    value._meta['smallbrain/version'] = String(
      capabilities.skill_catalogue.skill_version || SKILL_VERSION,
    );
  }

  if (value.name === 'perform_action' && capabilities) {
    const actions = capabilities.tools
      && capabilities.tools.perform_action
      && capabilities.tools.perform_action.actions;
    if (actions && typeof actions === 'object') {
      const enabled = Object.entries(actions)
        .filter(([, item]) => item && item.enabled === true && item.commissioning_only !== true)
        .map(([name]) => name)
        .sort();
      if (enabled.length) value.inputSchema.properties.action.enum = enabled;
    }
  }
  return value;
}

async function listTools() {
  const capabilities = await getCapabilities();
  return TOOL_CONTRACTS
    .filter((item) => capabilityAllows(item.name, item._meta['smallbrain/kind'], capabilities))
    .map((item) => dynamicTool(item, capabilities));
}

let anchorCache = null;

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function strings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
}

async function optionalJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function activeAtlasPath() {
  if (process.env.SMALL_BRAIN_ATLAS_PATH) {
    return path.resolve(process.env.SMALL_BRAIN_ATLAS_PATH);
  }
  const health = await gatewayRequest('GET', '/v1/health');
  const atlasFile = health && health.atlas && health.atlas.atlas_file;
  if (!atlasFile || typeof atlasFile !== 'string') {
    throw new AdapterError(
      'anchor_catalog_unavailable',
      'small-brain health does not expose atlas.atlas_file',
      { retryable: true },
    );
  }
  return path.resolve(atlasFile);
}

async function loadAnchorCatalog() {
  const atlasPath = await activeAtlasPath();
  let stat;
  try {
    stat = await fs.stat(atlasPath);
  } catch (cause) {
    throw new AdapterError('anchor_catalog_unavailable', `cannot stat Atlas manifest: ${cause.message}`, {
      retryable: true,
    });
  }
  if (anchorCache && anchorCache.atlasPath === atlasPath && anchorCache.mtimeMs === stat.mtimeMs) {
    return anchorCache;
  }

  let atlas;
  try {
    atlas = JSON.parse(await fs.readFile(atlasPath, 'utf8'));
  } catch (cause) {
    throw new AdapterError('anchor_catalog_unavailable', `cannot read Atlas manifest: ${cause.message}`, {
      retryable: true,
    });
  }
  const semanticRaw = atlas && atlas.source_semantic_map;
  if (!semanticRaw || typeof semanticRaw !== 'string') {
    throw new AdapterError('anchor_catalog_unavailable', 'Atlas manifest has no source_semantic_map');
  }
  const atlasDir = path.dirname(atlasPath);
  const semanticPath = path.isAbsolute(semanticRaw)
    ? semanticRaw
    : path.resolve(atlasDir, semanticRaw);
  let semantic;
  try {
    semantic = JSON.parse(await fs.readFile(semanticPath, 'utf8'));
  } catch (cause) {
    throw new AdapterError('anchor_catalog_unavailable', `cannot read Atlas semantic map: ${cause.message}`, {
      retryable: true,
    });
  }

  const allowedIds = new Set();
  for (const scene of Array.isArray(atlas.scenes) ? atlas.scenes : []) {
    for (const anchorId of strings(scene && scene.anchor_ids)) allowedIds.add(anchorId);
  }
  const topology = await optionalJson(path.join(atlasDir, 'semantic_topology.json'));
  if (topology && Array.isArray(topology.nodes)) {
    for (const node of topology.nodes) {
      if (!node || typeof node !== 'object' || String(node.nav_role || '') === 'reference_only') continue;
      const anchorId = String(node.anchor_id || '').trim();
      if (anchorId) allowedIds.add(anchorId);
    }
  }

  const records = semantic && semantic.anchors;
  if (!Array.isArray(records)) {
    throw new AdapterError('anchor_catalog_unavailable', 'semantic map anchors must be an array');
  }

  const canonicalByKey = new Map();
  const aliasesByKey = new Map();
  const ambiguousAliases = new Set();
  const numberOwners = new Map();
  const pendingAliases = [];

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const anchorId = String(record.anchor_id || '').trim();
    if (allowedIds.size && !allowedIds.has(anchorId)) continue;
    const canonical = ['name', 'display_name', 'base_name']
      .map((field) => String(record[field] || '').trim())
      .find(Boolean);
    if (!canonical) continue;
    const key = normalizeKey(canonical);
    if (canonicalByKey.has(key) && canonicalByKey.get(key) !== canonical) {
      throw new AdapterError('ambiguous_anchor_catalog', `canonical Anchor collision: ${canonical}`);
    }
    canonicalByKey.set(key, canonical);

    const numberMatches = canonical.match(/\d{2,4}/g) || [];
    for (const number of numberMatches) {
      if (!numberOwners.has(number)) numberOwners.set(number, new Set());
      numberOwners.get(number).add(canonical);
    }
    const spellings = new Set([
      ...strings(record.aliases),
      ...strings(record.auto_instance_aliases),
    ]);
    for (const field of ['display_name', 'base_name']) {
      const spelling = String(record[field] || '').trim();
      if (spelling && spelling !== canonical) spellings.add(spelling);
    }
    for (const spelling of spellings) pendingAliases.push([spelling, canonical]);
  }

  for (const [number, owners] of numberOwners.entries()) {
    if (owners.size === 1) pendingAliases.push([number, Array.from(owners)[0]]);
  }
  for (const [spelling, canonical] of pendingAliases) {
    const key = normalizeKey(spelling);
    if (!key || ambiguousAliases.has(key)) continue;
    const canonicalOwner = canonicalByKey.get(key);
    const previous = canonicalOwner || aliasesByKey.get(key);
    if (previous && previous !== canonical) {
      aliasesByKey.delete(key);
      ambiguousAliases.add(key);
      continue;
    }
    if (!canonicalOwner) aliasesByKey.set(key, canonical);
  }

  const lookup = new Map([...canonicalByKey.entries(), ...aliasesByKey.entries()]);
  anchorCache = {
    atlasPath,
    atlasId: String(atlas.atlas_id || ''),
    mtimeMs: stat.mtimeMs,
    lookup,
    canonicalNames: Array.from(canonicalByKey.values()),
  };
  return anchorCache;
}

const ANCHOR_FIELDS = Object.freeze({
  navigate: [['query', false]],
  handoff_delivery: [['pickup_anchor', false], ['dropoff_anchor', false]],
  knock_and_return: [['door_anchor', false], ['via_anchors', true]],
  find_and_approach_at: [['search_anchor', false]],
  return_and_rest: [['rest_anchor', false]],
  asset_check_at: [['inspection_anchor', false]],
  finite_patrol: [['anchors', true], ['return_anchor', false]],
});

async function normalizeAnchors(name, argumentsValue) {
  const fields = ANCHOR_FIELDS[name];
  if (!fields) return clone(argumentsValue);
  const present = fields.some(([field]) => argumentsValue[field] !== undefined);
  if (!present) return clone(argumentsValue);
  const catalog = await loadAnchorCatalog();
  const normalized = clone(argumentsValue);
  for (const [field, isArray] of fields) {
    if (normalized[field] === undefined) continue;
    if (isArray) {
      normalized[field] = normalized[field].map((item) => resolveAnchor(catalog, item, field));
    } else {
      normalized[field] = resolveAnchor(catalog, normalized[field], field);
    }
  }
  return normalized;
}

function resolveAnchor(catalog, raw, field) {
  const canonical = catalog.lookup.get(normalizeKey(raw));
  if (!canonical) {
    throw new AdapterError(
      'unknown_anchor',
      `${field} must exactly match a known Atlas Anchor or unambiguous alias`,
      { httpStatus: 422, retryable: false, details: { field, value: raw, atlas_id: catalog.atlasId } },
    );
  }
  return canonical;
}

function typeMatches(value, expected) {
  if (Array.isArray(expected)) return expected.some((item) => typeMatches(value, item));
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'integer') return Number.isInteger(value);
  return typeof value === expected;
}

function validateSchema(value, schema, valuePath = 'arguments') {
  if (!schema || typeof schema !== 'object') return [];
  const errors = [];
  if (schema.type !== undefined && !typeMatches(value, schema.type)) {
    return [`${valuePath} must have type ${JSON.stringify(schema.type)}`];
  }
  if (schema.const !== undefined && stableJson(value) !== stableJson(schema.const)) {
    errors.push(`${valuePath} must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => stableJson(item) === stableJson(value))) {
    errors.push(`${valuePath} must be one of ${JSON.stringify(schema.enum)}`);
  }

  if (schema.anyOf) {
    const matches = schema.anyOf.filter((candidate) => validateSchema(value, candidate, valuePath).length === 0);
    if (!matches.length) errors.push(`${valuePath} must satisfy at least one anyOf branch`);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => validateSchema(value, candidate, valuePath).length === 0);
    if (matches.length !== 1) errors.push(`${valuePath} must satisfy exactly one oneOf branch`);
  }
  if (schema.allOf) {
    for (const candidate of schema.allOf) errors.push(...validateSchema(value, candidate, valuePath));
  }
  if (schema.not && validateSchema(value, schema.not, valuePath).length === 0) {
    errors.push(`${valuePath} must not satisfy the forbidden schema`);
  }
  if (schema.if && validateSchema(value, schema.if, valuePath).length === 0 && schema.then) {
    errors.push(...validateSchema(value, schema.then, valuePath));
  } else if (schema.if && schema.else) {
    errors.push(...validateSchema(value, schema.else, valuePath));
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${valuePath} must contain at least ${schema.minLength} character(s)`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${valuePath} must contain at most ${schema.maxLength} character(s)`);
    }
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern).test(value))) {
      errors.push(`${valuePath} does not match ${schema.pattern}`);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${valuePath} must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${valuePath} must be <= ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${valuePath} must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${valuePath} must contain at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, index) => errors.push(...validateSchema(item, schema.items, `${valuePath}[${index}]`)));
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) {
        errors.push(`${valuePath}.${required} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${valuePath}.${key} is not supported`);
        }
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) errors.push(...validateSchema(child, properties[key], `${valuePath}.${key}`));
    }
    for (const [key, dependencies] of Object.entries(schema.dependentRequired || {})) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      for (const dependency of dependencies) {
        if (!Object.prototype.hasOwnProperty.call(value, dependency)) {
          errors.push(`${valuePath}.${dependency} is required when ${key} is supplied`);
        }
      }
    }
  }
  return errors;
}

function normalizeStatus(raw) {
  const status = String(raw || 'accepted');
  return ({
    queued: 'accepted',
    deferred: 'resting',
    waiting_for_idle: 'resting',
    dispatching: 'running',
    canceling: 'running',
    stopping: 'running',
  })[status] || status;
}

function normalizeLastAnchor(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const name = value.name || value.anchor_name || value.anchor_id;
    return name ? String(name) : null;
  }
  return null;
}

function taskContract(task, requestedName = '', requestId = null) {
  const skillValue = task && task.skill;
  const isSkill = skillValue && typeof skillValue === 'object' && !Array.isArray(skillValue);
  const skillName = isSkill ? String(skillValue.name || requestedName || '') || null : null;
  const skillVersion = isSkill ? String(skillValue.version || SKILL_VERSION) : null;
  const toolName = isSkill ? null : String(requestedName || task.tool || '') || null;
  const params = isSkill && skillValue.params && typeof skillValue.params === 'object'
    ? skillValue.params
    : task.params && typeof task.params === 'object'
      ? task.params
      : {};
  const nativeStatus = String(task.status || 'accepted');
  const status = normalizeStatus(nativeStatus);
  const rawError = task.error;
  const failure = !SUCCESS_STATUSES.has(status);
  const error = rawError
    ? errorObject(rawError, `${status}_error`)
    : failure
      ? errorObject({ code: status, message: `${requestedName || skillName || toolName || 'task'} ${status}` })
      : null;
  const nativeObservation = typeof task.observation === 'string' ? task.observation.trim() : '';
  let observation = nativeObservation;
  if (!observation && error) observation = error.message;
  if (!observation && status === 'succeeded') {
    observation = `${requestedName || skillName || toolName || 'task'} completed successfully`;
  }
  if (!observation && status === 'resting') observation = 'deferred rest policy is active';
  if (!observation && status === 'running') {
    observation = `${requestedName || skillName || toolName || 'task'} is running`;
  }
  if (!observation) observation = `${requestedName || skillName || toolName || 'task'} accepted by small brain`;

  const nativeAnchor = task.last_reached_anchor === undefined ? null : task.last_reached_anchor;
  return {
    success: SUCCESS_STATUSES.has(status),
    status,
    kind: isSkill ? 'skill' : 'robot_tool',
    task_id: task.task_id === undefined || task.task_id === null ? null : String(task.task_id),
    tool: toolName,
    skill: skillName,
    skill_version: skillVersion,
    params,
    last_reached_anchor: normalizeLastAnchor(nativeAnchor),
    recovery: task.recovery && typeof task.recovery === 'object' ? task.recovery : null,
    observation,
    result: task.result === undefined || task.result === null ? {} : task.result,
    error,
    metadata: {
      request_id: requestId,
      native_status: nativeStatus,
      native_phase: task.phase === undefined ? null : task.phase,
      native_last_reached_anchor: nativeAnchor,
      registry: REGISTRY_NAME,
      adapter_version: SERVER_VERSION,
    },
    steps: Array.isArray(task.steps) ? task.steps : [],
  };
}

function rejectedContract(name, error, requestId = null, params = {}) {
  const definition = CONTRACT_BY_NAME.get(name);
  const kind = definition ? definition._meta['smallbrain/kind'] : 'control_tool';
  const normalized = errorObject(error, 'adapter_error');
  return {
    success: false,
    status: 'rejected',
    kind,
    task_id: null,
    tool: kind === 'skill' ? null : name || null,
    skill: kind === 'skill' ? name : null,
    skill_version: kind === 'skill' ? SKILL_VERSION : null,
    params: params && typeof params === 'object' && !Array.isArray(params) ? params : {},
    last_reached_anchor: null,
    recovery: null,
    observation: normalized.message,
    result: {},
    error: normalized,
    metadata: {
      request_id: requestId,
      native_status: null,
      native_phase: null,
      native_last_reached_anchor: null,
      registry: REGISTRY_NAME,
      adapter_version: SERVER_VERSION,
    },
    steps: [],
  };
}

function controlContract(name, body, argumentsValue, requestId) {
  if (name !== 'x5_stream') {
    const value = taskContract(body, name, requestId);
    value.kind = 'control_tool';
    value.tool = name;
    value.skill = null;
    value.skill_version = null;
    value.params = argumentsValue;
    if (name === 'patrol_stop' && value.success) {
      value.observation = 'patrol stopped after the current Anchor boundary';
    }
    return value;
  }
  const state = String(body.state || body.status || 'unknown');
  const status = state === 'failed'
    ? 'failed'
    : ['ready', 'closed', 'stopped'].includes(state)
      ? 'succeeded'
      : 'running';
  const rawError = body.error || null;
  return {
    success: status !== 'failed',
    status,
    kind: 'control_tool',
    task_id: null,
    tool: name,
    skill: null,
    skill_version: null,
    params: argumentsValue,
    last_reached_anchor: null,
    recovery: null,
    observation: rawError
      ? errorObject(rawError).message
      : `x5_stream ${argumentsValue.action}: ${state}`,
    result: body,
    error: rawError ? errorObject(rawError) : null,
    metadata: {
      request_id: requestId,
      native_status: state,
      native_phase: null,
      native_last_reached_anchor: null,
      registry: REGISTRY_NAME,
      adapter_version: SERVER_VERSION,
    },
    steps: [],
  };
}

function extractRequestIdentity(request, context) {
  const meta = request && request.params && request.params._meta;
  const explicit = meta && (meta.request_id || meta.requestId || meta['brain/request_id']);
  const protocol = context && context.requestId !== undefined
    ? context.requestId
    : null;
  return {
    traceId: explicit !== undefined && explicit !== null
      ? String(explicit)
      : protocol === null
        ? null
        : String(protocol),
    idempotencyKey: explicit !== undefined && explicit !== null
      ? String(explicit)
      : null,
    protocolRequestId: protocol === null ? null : String(protocol),
  };
}

function taskIdFor(idempotencyKey) {
  if (!idempotencyKey) return `mcp:req:${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const digest = createHash('sha256')
    .update(`${CLIENT_NAMESPACE}\n${idempotencyKey}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `mcp:req:${digest}`;
}

async function waitForTask(task) {
  const taskId = task && task.task_id ? String(task.task_id) : '';
  if (!taskId) return task;
  const start = Date.now();
  let current = task;
  while (!TERMINAL_STATUSES.has(String(current.status || ''))) {
    if (MAX_WAIT_MS > 0 && Date.now() - start >= MAX_WAIT_MS) return current;
    await sleep(POLL_MS);
    current = await gatewayRequest('GET', `/v1/tasks/${taskId}`);
  }
  return current;
}

function waitsForCompletion(name, argumentsValue) {
  if (name === 'finite_patrol' || name === 'return_and_rest') return false;
  if (name === 'follow_person' && argumentsValue.until === 'cancelled') return false;
  return true;
}

async function assertCapabilityEnabled(name, definition) {
  const capabilities = await getCapabilities({ required: true });
  const kind = definition._meta['smallbrain/kind'];
  if (!capabilityAllows(name, kind, capabilities)) {
    throw new AdapterError(
      'capability_disabled',
      `${name} is not enabled by the current small-brain Registry`,
      { httpStatus: 422, retryable: false },
    );
  }
}

async function callTool(name, rawArguments, requestId = null, idempotencyKey = requestId) {
  const definition = CONTRACT_BY_NAME.get(name);
  if (!definition) {
    return rejectedContract(name, new AdapterError('unknown_tool', `unknown MCP Tool: ${name}`), requestId);
  }
  const argumentsValue = rawArguments === undefined ? {} : rawArguments;
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
    return rejectedContract(
      name,
      new AdapterError('invalid_params', 'arguments must be a JSON object'),
      requestId,
    );
  }
  const problems = validateSchema(argumentsValue, definition.inputSchema);
  if (problems.length) {
    return rejectedContract(
      name,
      new AdapterError('invalid_params', problems[0], {
        httpStatus: 422,
        retryable: false,
        details: { errors: problems },
      }),
      requestId,
      argumentsValue,
    );
  }

  try {
    await assertCapabilityEnabled(name, definition);

    if (name === 'get_task_status') {
      const task = await gatewayRequest('GET', `/v1/tasks/${argumentsValue.task_id}`);
      return taskContract(task, '', requestId);
    }
    if (name === 'patrol_stop') {
      const body = await gatewayRequest(
        'POST',
        `/v1/tasks/${argumentsValue.task_id}/patrol-stop`,
        { reason: String(argumentsValue.reason || 'brain_requested') },
      );
      const terminal = await waitForTask(body);
      return controlContract(name, terminal, argumentsValue, requestId);
    }
    if (name === 'x5_stream') {
      const body = await gatewayRequest('POST', '/v1/control-tools/x5_stream', argumentsValue);
      return controlContract(name, body, argumentsValue, requestId);
    }

    const normalizedArguments = await normalizeAnchors(name, argumentsValue);
    const taskId = taskIdFor(idempotencyKey);
    const payload = ROBOT_TOOLS.includes(name)
      ? { task_id: taskId, tool: name, params: normalizedArguments }
      : {
          task_id: taskId,
          skill: name,
          skill_version: SKILL_VERSION,
          params: normalizedArguments,
        };
    let task = await gatewayRequest('POST', '/v1/tasks', payload);
    if (waitsForCompletion(name, normalizedArguments)) task = await waitForTask(task);
    return taskContract(task, name, requestId);
  } catch (error) {
    return rejectedContract(name, error, requestId, argumentsValue);
  }
}

function mcpResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: !payload.success,
  };
}

function loadSdk() {
  const attempts = [];
  const packageJson = process.env.MCP_SDK_PACKAGE_JSON;
  const requireCandidates = [createRequire(import.meta.url)];
  if (packageJson) requireCandidates.push(createRequire(path.resolve(packageJson)));
  requireCandidates.push(createRequire(path.resolve(__dirname, '../packages/cli/package.json')));

  for (const localRequire of requireCandidates) {
    try {
      const { Server } = localRequire('@modelcontextprotocol/sdk/server/index.js');
      const { StreamableHTTPServerTransport } = localRequire(
        '@modelcontextprotocol/sdk/server/streamableHttp.js',
      );
      const { CallToolRequestSchema, ListToolsRequestSchema } = localRequire(
        '@modelcontextprotocol/sdk/types.js',
      );
      return { Server, StreamableHTTPServerTransport, CallToolRequestSchema, ListToolsRequestSchema };
    } catch (error) {
      attempts.push(String(error.message || error));
    }
  }
  throw new Error(
    'Cannot resolve @modelcontextprotocol/sdk. Install it beside this file or set '
      + `MCP_SDK_PACKAGE_JSON. Last error: ${attempts[attempts.length - 1] || 'unknown'}`,
  );
}

function createMcpServer(sdk) {
  const server = new sdk.Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: (
        'Use tools/list for the live small-brain capability surface. The Brain grounds fuzzy '
        + 'language into exact Atlas Anchors before calling navigate or a Named Skill. Named '
        + 'Skills are called once and expanded only by the small brain. Never send pose, path, '
        + 'Atlas, Connector, gait, lease, or velocity fields.'
      ),
    },
  );

  server.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({ tools: await listTools() }));
  server.setRequestHandler(sdk.CallToolRequestSchema, async (request, context) => {
    const name = request.params.name;
    const argumentsValue = request.params.arguments || {};
    const identity = extractRequestIdentity(request, context);
    console.log(JSON.stringify({
      event: 'mcp_tools_call',
      request_id: identity.traceId,
      protocol_request_id: identity.protocolRequestId,
      idempotency_key: identity.idempotencyKey,
      name,
      arguments: argumentsValue,
      at: new Date().toISOString(),
    }));
    const payload = await callTool(
      name,
      argumentsValue,
      identity.traceId,
      identity.idempotencyKey,
    );
    console.log(JSON.stringify({
      event: 'mcp_tools_result',
      request_id: identity.traceId,
      protocol_request_id: identity.protocolRequestId,
      idempotency_key: identity.idempotencyKey,
      task_id: payload.task_id,
      name,
      status: payload.status,
      error: payload.error,
      at: new Date().toISOString(),
    }));
    return mcpResult(payload);
  });
  return server;
}

function sendJson(response, status, body, extraHeaders = {}) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(raw.length),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, accept, mcp-session-id, mcp-protocol-version, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    ...extraHeaders,
  });
  response.end(raw);
}

function bearerAuthorized(request) {
  if (ALLOW_UNAUTHENTICATED) return true;
  if (!MCP_TOKEN) return false;
  const actual = Buffer.from(String(request.headers.authorization || ''), 'utf8');
  const expected = Buffer.from(`Bearer ${MCP_TOKEN}`, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function healthPayload() {
  const base = {
    ok: true,
    service: SERVER_NAME,
    version: SERVER_VERSION,
    registry: REGISTRY_NAME,
    transport: 'streamableHttp',
    mcp: `http://${HOST}:${PORT}${MCP_PATH}`,
    expected_tools: 19,
    robot_tools: ROBOT_TOOLS.length,
    skills: NAMED_SKILLS.length,
    control_tools: CONTROL_TOOLS,
    authentication: ALLOW_UNAUTHENTICATED ? 'none' : 'bearerAuth',
    smallbrain_gateway: GATEWAY_URL,
  };
  try {
    const capabilities = await getCapabilities({ force: true, required: true });
    const tools = await listTools();
    return {
      ...base,
      smallbrain_reachable: true,
      capability_schema: capabilities.schema || null,
      exposed_tools: tools.map((item) => item.name),
    };
  } catch (error) {
    return {
      ...base,
      smallbrain_reachable: false,
      smallbrain_error: errorObject(error),
      exposed_tools: (await listTools()).map((item) => item.name),
    };
  }
}

async function startServer() {
  if (!ALLOW_UNAUTHENTICATED && !MCP_TOKEN) {
    throw new Error(
      'SMALL_BRAIN_MCP_TOKEN is required in production; set '
        + 'SMALL_BRAIN_MCP_ALLOW_UNAUTHENTICATED=1 only for isolated development.',
    );
  }
  const sdk = loadSdk();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
      if (request.method === 'OPTIONS') {
        sendJson(response, 204, {});
        return;
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, await healthPayload());
        return;
      }
      if (url.pathname !== MCP_PATH) {
        sendJson(response, 404, { error: { code: 'not_found', message: `Use ${MCP_PATH}` } });
        return;
      }
      if (!bearerAuthorized(request)) {
        sendJson(response, 401, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32001, message: 'Unauthorized' },
        }, { 'WWW-Authenticate': 'Bearer' });
        return;
      }

      const mcpServer = createMcpServer(sdk);
      const transport = new sdk.StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'mcp_http_error',
        error: errorObject(error),
        at: new Date().toISOString(),
      }));
      if (!response.headersSent) {
        sendJson(response, 500, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: String(error.message || error) },
        });
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolve);
  });
  console.log(`[smallbrain-mcp] registry=${REGISTRY_NAME}`);
  console.log(`[smallbrain-mcp] listening on http://${HOST}:${PORT}`);
  console.log(`[smallbrain-mcp] MCP URL=http://${HOST}:${PORT}${MCP_PATH}`);
  console.log(`[smallbrain-mcp] Gateway=${GATEWAY_URL}`);
  console.log('[smallbrain-mcp] capability target=19 (10 robot + 6 skills + 3 control/helpers)');
  return server;
}

async function dumpTools() {
  console.log(JSON.stringify({ tools: await listTools() }, null, 2));
}

export {
  CONTROL_TOOLS,
  NAMED_SKILLS,
  OUTPUT_SCHEMA,
  ROBOT_TOOLS,
  TOOL_CONTRACTS,
  callTool,
  listTools,
  loadAnchorCatalog,
  mcpResult,
  startServer,
  validateSchema,
};

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  if (process.argv.includes('--dump-tools')) await dumpTools();
  else await startServer();
}
