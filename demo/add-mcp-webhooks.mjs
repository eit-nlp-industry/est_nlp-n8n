/**
 * Add Webhook triggers to Demo Lookup Weather / Order so they become MCP-eligible.
 * Does not modify n8n source. Talks to a running local instance.
 */
const BASE = process.env.N8N_BASE_URL?.replace(/\/$/, '') || 'http://localhost:5678';
const EMAIL = 'demo@example.com';
const PASSWORD = 'DemoN8n2026!';
const BROWSER_ID = 'n8n-demo-bootstrap';

const IDS = {
	weather: 'liWTYYjfJm1RGwpc',
	order: 'trDI8XqAkjmpT80n',
};

function cookieHeader(setCookies) {
	const parts = [];
	for (const c of setCookies) {
		const pair = c.split(';')[0];
		if (pair.startsWith('n8n-auth=')) parts.push(pair);
	}
	return parts.join('; ');
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
		throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 800)}`);
	}
	return { json, setCookies, status: res.status };
}

function payload(json) {
	if (json && typeof json === 'object' && 'data' in json) return json.data;
	return json;
}

function hasWebhook(wf) {
	return (wf.nodes ?? []).some((n) => n.type === 'n8n-nodes-base.webhook');
}

function addWebhook(wf, { path, formatNode, webhookId, nodeId }) {
	if (hasWebhook(wf)) {
		return { wf, added: false };
	}

	const webhookNode = {
		parameters: {
			httpMethod: 'POST',
			path,
			responseMode: 'lastNode',
			options: {},
		},
		id: nodeId,
		name: 'Webhook',
		type: 'n8n-nodes-base.webhook',
		typeVersion: 2,
		position: [240, 120],
		webhookId,
	};

	wf.nodes = [...wf.nodes, webhookNode];
	wf.connections = {
		...wf.connections,
		Webhook: {
			main: [[{ node: formatNode, type: 'main', index: 0 }]],
		},
	};
	return { wf, added: true };
}

async function main() {
	const login = await request('POST', '/rest/login', {
		body: { emailOrLdapLoginId: EMAIL, password: PASSWORD },
	});
	const cookie = cookieHeader(login.setCookies);
	if (!cookie) throw new Error('Login succeeded but n8n-auth cookie was missing');

	const specs = [
		{
			id: IDS.weather,
			path: 'mcp-weather',
			formatNode: 'Format Weather',
			webhookId: 'a1e0c111-0001-4000-8000-webhook0001',
			nodeId: 'a1e0c111-0001-4000-8000-0000000000wh',
			sample: { city: 'Shanghai' },
		},
		{
			id: IDS.order,
			path: 'mcp-order',
			formatNode: 'Format Order',
			webhookId: 'b2e0c222-0002-4000-8000-webhook0001',
			nodeId: 'b2e0c222-0002-4000-8000-0000000000wh',
			sample: { orderId: 'ORD-1001' },
		},
	];

	const results = [];

	for (const spec of specs) {
		const got = payload(await request('GET', `/rest/workflows/${spec.id}`, { cookie }).then((r) => r.json));
		if (!got?.id) throw new Error(`Workflow ${spec.id} not found`);

		const { wf, added } = addWebhook(got, spec);
		let current = got;
		if (added) {
			current = payload(
				(
					await request('PATCH', `/rest/workflows/${spec.id}`, {
						cookie,
						body: {
							name: wf.name,
							nodes: wf.nodes,
							connections: wf.connections,
							settings: wf.settings ?? { executionOrder: 'v1' },
							versionId: wf.versionId,
						},
					})
				).json,
			);
			console.log(`Added Webhook POST /webhook/${spec.path} to ${current.name} (${spec.id})`);
		} else {
			console.log(`${got.name} already has a Webhook node`);
		}

		await request('POST', `/rest/workflows/${spec.id}/activate`, {
			cookie,
			body: { versionId: current.versionId, name: current.name },
		});
		console.log(`Published ${current.name}`);

		const url = `${BASE}/webhook/${spec.path}`;
		const probe = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(spec.sample),
		});
		const probeText = await probe.text();
		let probeJson;
		try {
			probeJson = JSON.parse(probeText);
		} catch {
			probeJson = probeText;
		}
		if (!probe.ok) {
			throw new Error(`Webhook ${url} -> ${probe.status} ${probeText.slice(0, 800)}`);
		}
		results.push({ name: current.name, id: spec.id, url, sample: spec.sample, response: probeJson });
	}

	console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
