import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { Request, RequestHandler } from 'express';
import { createProxyMiddleware, fixRequestBody, responseInterceptor } from 'http-proxy-middleware';

import type { DeepSeekHarnessWebService } from './deepseek-harness-web.service';

export const STUDIO_PROXY_PATH_PREFIX = '/deepseek-harness-studio';

const STUDIO_PROXY_PATH_PATTERN =
	/^\/deepseek-harness-studio\/(?<projectId>[^/]+)\/(?<agentId>[^/]+)(?:\/(?<rest>.*))?$/;

const STUDIO_HOST_OWNERSHIP_SCRIPT =
	'<script>globalThis.__DSH_TRANSPORT__={...(globalThis.__DSH_TRANSPORT__??{}),ownsHost:true};</script>';

export function injectStudioHostOwnership(html: string): string {
	const closingHeadIndex = html.search(/<\/head\s*>/iu);
	if (closingHeadIndex === -1) return html;
	return `${html.slice(0, closingHeadIndex)}${STUDIO_HOST_OWNERSHIP_SCRIPT}${html.slice(closingHeadIndex)}`;
}

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

type ProxyMiddleware = RequestHandler & {
	upgrade?: (req: IncomingMessage, socket: Socket, head: Buffer) => void;
};

/**
 * Forward Studio traffic while preserving the browser-facing authority.
 * Harness validates Host, Origin, and Fetch Metadata against `--trusted-host`.
 */
export function createStudioProxyMiddleware(
	webService: DeepSeekHarnessWebService,
): ProxyMiddleware {
	const router = (req: Request) => {
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
	};
	const pathRewrite = (_path: string, req: Request) => {
		const url = new URL(req.url, 'http://studio.invalid');
		return `${url.pathname}${url.search}`;
	};
	const proxyReq = (outgoingRequest: Parameters<typeof fixRequestBody>[0], req: Request) => {
		fixRequestBody(outgoingRequest, req);
	};
	const rewriteResponseCookies = (
		setCookie: string | string[] | undefined,
		req: Request,
	): string[] | undefined => {
		const projectId = req.params.projectId;
		const agentId = req.params.agentId;
		if (typeof projectId !== 'string' || typeof agentId !== 'string') return undefined;
		return rewriteSetCookiePaths(setCookie, studioProxyBasePath(projectId, agentId));
	};
	const proxyError = (_error: Error, _req: Request, res: ServerResponse) => {
		if (!res.headersSent) {
			res.writeHead(502);
			res.end('Bad Gateway');
		}
	};

	const streamingProxy = createProxyMiddleware<Request>({
		changeOrigin: false,
		ws: true,
		router,
		pathRewrite,
		on: {
			proxyReq,
			proxyRes: (proxyRes, req) => {
				const rewrittenCookies = rewriteResponseCookies(proxyRes.headers['set-cookie'], req);
				if (rewrittenCookies) proxyRes.headers['set-cookie'] = rewrittenCookies;
			},
			error: proxyError,
		},
	});

	const entryProxy = createProxyMiddleware<Request>({
		changeOrigin: false,
		selfHandleResponse: true,
		router,
		pathRewrite,
		on: {
			proxyReq,
			proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
				const rewrittenCookies = rewriteResponseCookies(proxyRes.headers['set-cookie'], req);
				if (rewrittenCookies) res.setHeader('set-cookie', rewrittenCookies);
				const contentType = proxyRes.headers['content-type'];
				if (!contentType?.toLowerCase().includes('text/html')) return responseBuffer;
				return injectStudioHostOwnership(responseBuffer.toString('utf8'));
			}),
			error: proxyError,
		},
	});

	const proxy = (async (req, res, next) => {
		const requestUrl = new URL(req.url, 'http://studio.invalid');
		const isEntryRequest = req.method === 'GET' && requestUrl.pathname === '/';
		await (isEntryRequest ? entryProxy(req, res, next) : streamingProxy(req, res, next));
	}) as ProxyMiddleware;
	proxy.upgrade = streamingProxy.upgrade;
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
