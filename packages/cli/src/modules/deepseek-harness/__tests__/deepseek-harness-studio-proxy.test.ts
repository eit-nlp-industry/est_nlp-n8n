import express from 'express';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';

import {
	attachStudioProxyUpgrade,
	buildStudioProxyUrl,
	createStudioProxyMiddleware,
	injectStudioHostOwnership,
	rewriteSetCookiePaths,
	studioProxyBasePath,
} from '../deepseek-harness-studio-proxy';

describe('deepseek-harness-studio-proxy', () => {
	it('builds a same-origin iframe URL with a trailing slash before the query', () => {
		expect(
			buildStudioProxyUrl('project-1', 'agent-1', 'http://127.0.0.1:43123/?token=secret'),
		).toBe('/deepseek-harness-studio/project-1/agent-1/?token=secret');
	});

	it('encodes project and agent path segments', () => {
		expect(studioProxyBasePath('proj/a', 'agent b')).toBe(
			'/deepseek-harness-studio/proj%2Fa/agent%20b',
		);
	});

	it('rewrites Set-Cookie Path to the studio proxy base', () => {
		expect(
			rewriteSetCookiePaths(
				['session=abc; Path=/; HttpOnly', 'x=1'],
				'/deepseek-harness-studio/p/a',
			),
		).toEqual([
			'session=abc; Path=/deepseek-harness-studio/p/a; HttpOnly',
			'x=1; Path=/deepseek-harness-studio/p/a',
		]);
	});

	it('injects Host ownership into an HTML document', () => {
		const html = injectStudioHostOwnership('<html><head><title>Studio</title></head></html>');

		expect(html).toContain(
			'globalThis.__DSH_TRANSPORT__={...(globalThis.__DSH_TRANSPORT__??{}),ownsHost:true}',
		);
		expect(html.indexOf('ownsHost:true')).toBeLessThan(html.indexOf('</head>'));
		expect(injectStudioHostOwnership('not html')).toBe('not html');
	});

	it('preserves public trust headers across HTTP and WebSocket proxying', async () => {
		const observedHttpHeaders: Array<Record<string, string | string[] | undefined>> = [];
		const observedHttpBodies: string[] = [];
		const observedWebSocketHeaders: Array<Record<string, string | string[] | undefined>> = [];
		const backend = createServer((req, res) => {
			if (req.url === '/?token=secret') {
				res.writeHead(303, {
					location: './',
					'set-cookie': 'dsh-auth=test; Path=/; HttpOnly',
				});
				res.end();
				return;
			}
			if (req.url === '/') {
				res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
				res.end('<html><head><title>Studio</title></head><body>ready</body></html>');
				return;
			}
			if (req.url === '/api/directoryPicker/list') {
				observedHttpHeaders.push(req.headers);
				let body = '';
				req.on('data', (chunk: Buffer) => {
					body += chunk.toString();
				});
				req.on('end', () => {
					observedHttpBodies.push(body);
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end('{"ok":true}');
				});
				return;
			}
			res.writeHead(404);
			res.end();
		});
		const backendWebSockets = new WebSocketServer({ noServer: true });
		backend.on('upgrade', (req, socket, head) => {
			if (req.url !== '/api/remote.mux') {
				socket.destroy();
				return;
			}
			observedWebSocketHeaders.push(req.headers);
			backendWebSockets.handleUpgrade(req, socket, head, (webSocket) => {
				webSocket.send('ready');
			});
		});

		const backendPort = await listen(backend);
		const webService = {
			getRunningOrigin: () => `http://127.0.0.1:${backendPort}`,
		};
		const app = express();
		app.use(express.json());
		const proxy = createStudioProxyMiddleware(webService as never);
		app.use('/deepseek-harness-studio/:projectId/:agentId', proxy);
		const proxyServer = createServer(app);
		attachStudioProxyUpgrade(proxyServer, webService as never, proxy);
		const proxyPort = await listen(proxyServer);
		const basePath = '/deepseek-harness-studio/project-1/agent-1';

		try {
			const auth = await request(proxyPort, `${basePath}/?token=secret`, {
				host: 'public.localhost',
			});
			expect(auth.statusCode).toBe(303);
			expect(auth.headers['set-cookie']).toEqual([`dsh-auth=test; Path=${basePath}; HttpOnly`]);

			const index = await request(proxyPort, `${basePath}/`, {
				host: 'public.localhost',
				cookie: 'dsh-auth=test',
			});
			expect(index.statusCode).toBe(200);
			expect(index.body).toContain('ownsHost:true');

			const requestBody = JSON.stringify({ args: [{ path: '/workspace' }] });
			const response = await request(
				proxyPort,
				`${basePath}/api/directoryPicker/list`,
				{
					host: 'public.localhost',
					origin: 'http://public.localhost',
					'sec-fetch-site': 'same-origin',
					cookie: 'dsh-auth=test',
					'content-type': 'application/json',
					'content-length': String(Buffer.byteLength(requestBody)),
				},
				'POST',
				requestBody,
			);
			expect(response.statusCode).toBe(200);
			expect(response.body).toBe('{"ok":true}');
			expect(response.body).not.toContain('ownsHost:true');
			expect(observedHttpBodies).toEqual([requestBody]);
			expect(observedHttpHeaders).toEqual([
				expect.objectContaining({
					host: 'public.localhost',
					origin: 'http://public.localhost',
					'sec-fetch-site': 'same-origin',
					cookie: 'dsh-auth=test',
				}),
			]);

			const webSocket = new WebSocket(`ws://127.0.0.1:${proxyPort}${basePath}/api/remote.mux`, {
				headers: {
					host: 'public.localhost',
					origin: 'http://public.localhost',
					cookie: 'dsh-auth=test',
				},
			});
			await expect(
				new Promise<string>((resolve, reject) => {
					webSocket.once('message', (data) => resolve(data.toString()));
					webSocket.once('error', reject);
				}),
			).resolves.toBe('ready');
			expect(observedWebSocketHeaders).toEqual([
				expect.objectContaining({
					host: 'public.localhost',
					origin: 'http://public.localhost',
					cookie: 'dsh-auth=test',
				}),
			]);
			webSocket.close();
		} finally {
			backendWebSockets.close();
			await Promise.all([close(proxyServer), close(backend)]);
		}
	});
});

async function listen(server: Server): Promise<number> {
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

async function request(
	port: number,
	path: string,
	headers: Record<string, string>,
	method = 'GET',
	body?: string,
): Promise<{
	statusCode: number | undefined;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}> {
	return await new Promise((resolve, reject) => {
		const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
			let responseBody = '';
			res.setEncoding('utf8');
			res.on('data', (chunk: string) => {
				responseBody += chunk;
			});
			res.once('end', () => {
				resolve({ statusCode: res.statusCode, headers: res.headers, body: responseBody });
			});
		});
		req.once('error', reject);
		req.end(body);
	});
}
