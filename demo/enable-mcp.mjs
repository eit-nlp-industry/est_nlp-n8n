const BASE = process.env.N8N_BASE_URL?.replace(/\/$/, '') || 'http://localhost:5678';
const EMAIL = 'demo@example.com';
const PASSWORD = 'DemoN8n2026!';
const BROWSER_ID = 'n8n-demo-bootstrap';
const WORKFLOW_IDS = ['liWTYYjfJm1RGwpc', 'trDI8XqAkjmpT80n'];

function cookieHeader(setCookies) {
	return setCookies
		.map((c) => c.split(';')[0])
		.filter((p) => p.startsWith('n8n-auth='))
		.join('; ');
}

async function request(method, path, { cookie, body } = {}) {
	const headers = {
		Accept: 'application/json',
		'Content-Type': 'application/json',
		'browser-id': BROWSER_ID,
	};
	if (cookie) headers.Cookie = cookie;
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = { raw: text };
	}
	if (!res.ok) {
		throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 1200)}`);
	}
	return { json, setCookies };
}

function payload(json) {
	if (json && typeof json === 'object' && 'data' in json) return json.data;
	return json;
}

async function main() {
	const login = await request('POST', '/rest/login', {
		body: { emailOrLdapLoginId: EMAIL, password: PASSWORD },
	});
	const cookie = cookieHeader(login.setCookies);
	if (!cookie) throw new Error('Missing n8n-auth cookie');

	const settings = payload(
		(await request('PATCH', '/rest/mcp/settings', { cookie, body: { mcpAccessEnabled: true } })).json,
	);
	console.log('MCP settings:', JSON.stringify(settings));

	const toggled = payload(
		(
			await request('PATCH', '/rest/mcp/workflows/toggle-access', {
				cookie,
				body: { availableInMCP: true, workflowIds: WORKFLOW_IDS },
			})
		).json,
	);
	console.log('Toggle access:', JSON.stringify(toggled, null, 2));

	for (const id of WORKFLOW_IDS) {
		const wf = payload((await request('GET', `/rest/workflows/${id}`, { cookie })).json);
		console.log(`${wf.name} (${id}) availableInMCP=${wf.settings?.availableInMCP} active=${Boolean(wf.activeVersionId ?? wf.active)}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
