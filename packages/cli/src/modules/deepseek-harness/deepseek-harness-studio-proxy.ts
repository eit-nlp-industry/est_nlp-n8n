import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Request, RequestHandler, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

import type { DeepSeekHarnessWebService } from './deepseek-harness-web.service';

export const STUDIO_PROXY_PATH_PREFIX = '/deepseek-harness-studio';

const STUDIO_PROXY_PATH_PATTERN =
	/^\/deepseek-harness-studio\/(?<projectId>[^/]+)\/(?<agentId>[^/]+)(?:\/(?<rest>.*))?$/;

export function studioProxyBasePath(projectId: string, agentId: string): string {
	return `${STUDIO_PROXY_PATH_PREFIX}/${encodeURIComponent(projectId)}/${encodeURIComponent(agentId)}`;
}

/** Browser iframe URL on the n8n origin. Keeps the Harness auth query string. */
export function buildStudioProxyUrl(
	projectId: string,
	agentId: string,
	runtimeUrl: string,
): string {
	const search = new URL(runtimeUrl).search;
	return `${studioProxyBasePath(projectId, agentId)}/${search}`;
}

export function rewriteHarnessApiPaths(body: string, proxyBasePath: string): string {
	return body
		.replaceAll('"/api', `"${proxyBasePath}/api`)
		.replaceAll("'/api", `'${proxyBasePath}/api`)
		.replaceAll('`/api', `\`${proxyBasePath}/api`);
}

export function rewriteSetCookiePaths(
	setCookie: string | string[] | undefined,
	proxyBasePath: string,
): string[] | undefined {
	if (!setCookie) return undefined;
	const values = Array.isArray(setCookie) ? setCookie : [setCookie];
	return values.map((cookie) => {
		if (/;\s*Path=/i.test(cookie)) {
			return cookie.replace(/;\s*Path=[^;]*/i, `; Path=${proxyBasePath}`);
		}
		return `${cookie}; Path=${proxyBasePath}`;
	});
}

function parseStudioProxyPath(urlPath: string): {
	projectId: string;
	agentId: string;
	rest: string;
} | null {
	const match = STUDIO_PROXY_PATH_PATTERN.exec(urlPath);
	if (!match?.groups?.projectId || !match.groups.agentId) return null;
	return {
		projectId: decodeURIComponent(match.groups.projectId),
		agentId: decodeURIComponent(match.groups.agentId),
		rest: match.groups.rest ?? '',
	};
}

function shouldRewriteBody(contentType: string | undefined): boolean {
	if (!contentType) return false;
	const normalized = contentType.toLowerCase();
	if (normalized.includes('sourcemap')) return false;
	return (
		normalized.includes('javascript') ||
		normalized.includes('text/html') ||
		normalized.includes('application/json') ||
		normalized.includes('text/css')
	);
}

type ProxyMiddleware = RequestHandler & {
	upgrade?: (req: IncomingMessage, socket: Socket, head: Buffer) => void;
};

/**
 * Express middleware that forwards Studio traffic to the agent Harness process
 * and rewrites absolute `/api` references so the SPA works under a subpath.
 */
export function createStudioProxyMiddleware(
	webService: DeepSeekHarnessWebService,
): ProxyMiddleware {
	const proxy = createProxyMiddleware({
		changeOrigin: true,
		ws: true,
		selfHandleResponse: true,
		router: (req) => {
			const projectId = req.params.projectId;
			const agentId = req.params.agentId;
			if (typeof projectId !== 'string' || typeof agentId !== 'string') {
				throw new Error('DeepSeek Harness studio proxy is missing route params');
			}
			const origin = webService.getRunningOrigin(projectId, agentId);
			if (!origin) {
				throw new Error('DeepSeek Harness studio runtime is not running');
			}
			return origin;
		},
		pathRewrite: (_path, req) => {
			const url = new URL(req.url ?? '/', 'http://studio.invalid');
			return `${url.pathname}${url.search}`;
		},
		on: {
			proxyReq: (proxyReq) => {
				// Avoid gzip so the response body can be rewritten safely.
				proxyReq.setHeader('accept-encoding', 'identity');
			},
			proxyRes: (proxyRes, req, res) => {
				const expressReq = req as Request;
				const expressRes = res as Response;
				const projectId = expressReq.params.projectId;
				const agentId = expressReq.params.agentId;
				if (typeof projectId !== 'string' || typeof agentId !== 'string') {
					expressRes.statusCode = 502;
					expressRes.end('Bad Gateway');
					return;
				}

				const proxyBasePath = studioProxyBasePath(projectId, agentId);
				const headers = { ...proxyRes.headers };
				const rewrittenCookies = rewriteSetCookiePaths(headers['set-cookie'], proxyBasePath);
				if (rewrittenCookies) headers['set-cookie'] = rewrittenCookies;

				const contentType = headers['content-type'];
				const contentTypeValue = Array.isArray(contentType) ? contentType[0] : contentType;

				if (!shouldRewriteBody(contentTypeValue)) {
					expressRes.writeHead(proxyRes.statusCode ?? 502, headers);
					proxyRes.pipe(expressRes);
					return;
				}

				const chunks: Buffer[] = [];
				proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
				proxyRes.on('end', () => {
					const original = Buffer.concat(chunks).toString('utf8');
					const rewritten = rewriteHarnessApiPaths(original, proxyBasePath);
					const body = Buffer.from(rewritten, 'utf8');
					delete headers['content-length'];
					headers['content-length'] = String(body.byteLength);
					expressRes.writeHead(proxyRes.statusCode ?? 502, headers);
					expressRes.end(body);
				});
				proxyRes.on('error', () => {
					if (!expressRes.headersSent) {
						expressRes.statusCode = 502;
						expressRes.end('Bad Gateway');
					}
				});
			},
			error: (_error, _req, res) => {
				if ('writeHead' in res && !res.headersSent) {
					res.writeHead(502);
					res.end('Bad Gateway');
				}
			},
		},
	}) as ProxyMiddleware;

	return proxy;
}

/** Attach WebSocket upgrades for Studio proxy paths to the main HTTP server. */
export function attachStudioProxyUpgrade(
	server: Server,
	webService: DeepSeekHarnessWebService,
	proxy: ProxyMiddleware,
): void {
	server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
		const requestUrl = new URL(req.url ?? '/', 'http://studio.invalid');
		const parsed = parseStudioProxyPath(requestUrl.pathname);
		if (!parsed) return;

		const origin = webService.getRunningOrigin(parsed.projectId, parsed.agentId);
		if (!origin) {
			socket.destroy();
			return;
		}

		// Present the path Harness expects after the Express mount strip.
		req.url = `/${parsed.rest}${requestUrl.search}`;
		(req as IncomingMessage & { params?: Record<string, string> }).params = {
			projectId: parsed.projectId,
			agentId: parsed.agentId,
		};

		proxy.upgrade?.(req, socket, head);
	});
}
