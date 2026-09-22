/**
 * Patch the running n8n agent with Render Dashboard + instruction addendum.
 * Does not print secrets.
 *
 *   node demo/agents/apply-robotdog-dashboard.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');

function loadEnvLocal() {
	const envPath = path.join(repoRoot, '.env.local');
	const env = {};
	try {
		for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
			const line = raw.trim();
			if (!line || line.startsWith('#')) continue;
			const i = line.indexOf('=');
			if (i < 1) continue;
			let value = line.slice(i + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			env[line.slice(0, i).trim()] = value;
		}
	} catch {
		// fall through to defaults
	}
	return env;
}

const DASHBOARD_MARKER = '【展示看板 render_dashboard】';
const MCP_MARKER = '【真实 MCP 契约 L1-L4】';

function stripAddendum(instructions) {
	const hits = [DASHBOARD_MARKER, MCP_MARKER]
		.map((marker) => instructions.indexOf(marker))
		.filter((i) => i >= 0);
	if (hits.length === 0) return instructions.trimEnd();
	return instructions.slice(0, Math.min(...hits)).trimEnd();
}

function cookieHeader(setCookieHeaders) {
	return setCookieHeaders
		.map((entry) => entry.split(';', 1)[0])
		.filter(Boolean)
		.join('; ');
}

const env = loadEnvLocal();
const port = Number(env.N8N_PORT || 5720);
const base = `http://127.0.0.1:${port}`;
const email = env.DEMO_OWNER_EMAIL || 'admin@local.dev';
const password = env.DEMO_OWNER_PASSWORD || 'LocalDev123!';
const addendum = readFileSync(path.join(__dirname, 'dashboard-addendum.txt'), 'utf8').trim();
const dashboardTool = JSON.parse(
	readFileSync(path.join(__dirname, 'render-dashboard.tool.json'), 'utf8'),
);

const loginRes = await fetch(`${base}/rest/login`, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ emailOrLdapLoginId: email, password }),
});
if (!loginRes.ok) {
	throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
}
const cookie = cookieHeader(loginRes.headers.getSetCookie?.() ?? []);
if (!cookie) throw new Error('Login succeeded but no Set-Cookie was returned');

const headers = { cookie, 'content-type': 'application/json' };
const listRes = await fetch(`${base}/rest/agents/v2?take=50`, { headers });
if (!listRes.ok) {
	throw new Error(`List agents failed: ${listRes.status} ${await listRes.text()}`);
}
const listed = await listRes.json();
const agents = Array.isArray(listed) ? listed : (listed.data ?? listed.items ?? []);
const match = agents.find((agent) => String(agent.name ?? '').includes('机器狗'));
if (!match) {
	console.log(
		`No agent named 机器狗 on ${base}. Import demo/agents/机器狗-加权语义检索-v3-dashboard.json from the builder ⋯ menu.`,
	);
	console.log(
		`Visible agents: ${agents.map((a) => a.name).join(', ') || '(none)'}`,
	);
	process.exit(2);
}

const projectId = match.projectId;
const agentId = match.id;
const getRes = await fetch(`${base}/rest/projects/${projectId}/agents/v2/${agentId}/config`, {
	headers,
});
if (!getRes.ok) {
	throw new Error(`Get config failed: ${getRes.status} ${await getRes.text()}`);
}
const config = await getRes.json();
config.tools = (config.tools ?? []).filter((tool) => tool.name !== 'render_dashboard');
config.tools.push(dashboardTool);
config.instructions = `${stripAddendum(config.instructions ?? '')}\n\n${addendum}\n`;

const putRes = await fetch(`${base}/rest/projects/${projectId}/agents/v2/${agentId}/config`, {
	method: 'PUT',
	headers,
	body: JSON.stringify({ config }),
});
if (!putRes.ok) {
	throw new Error(`Update config failed: ${putRes.status} ${await putRes.text()}`);
}

console.log(`Updated agent ${agentId} in project ${projectId}`);
console.log(`tools: ${(config.tools ?? []).map((t) => t.name).join(', ')}`);
