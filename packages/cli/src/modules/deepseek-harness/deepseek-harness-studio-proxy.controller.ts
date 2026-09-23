import { Container } from '@n8n/di';
import { RootLevelController, StaticRouterMetadata } from '@n8n/decorators';
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Server } from 'node:http';

import {
	STUDIO_PROXY_PATH_PREFIX,
	attachStudioProxyUpgrade,
	createStudioProxyMiddleware,
} from './deepseek-harness-studio-proxy';
import { DeepSeekHarnessWebService } from './deepseek-harness-web.service';

function createStudioProxyRouter() {
	const router = Router({ mergeParams: true });
	const webService = Container.get(DeepSeekHarnessWebService);
	const proxy = createStudioProxyMiddleware(webService);

	router.use((req: Request, res: Response, next) => {
		const { projectId, agentId } = req.params;
		if (typeof projectId !== 'string' || typeof agentId !== 'string') {
			res.status(400).send('Invalid DeepSeek Harness studio proxy path');
			return;
		}
		if (!webService.getRunningOrigin(projectId, agentId)) {
			res.status(502).send('DeepSeek Harness studio runtime is not running');
			return;
		}
		next();
	});

	router.use(proxy);

	return { router, proxy, webService };
}

const studioProxy = createStudioProxyRouter();

@RootLevelController()
export class DeepSeekHarnessStudioProxyController {
	static routers: StaticRouterMetadata[] = [
		{
			path: `${STUDIO_PROXY_PATH_PREFIX}/:projectId/:agentId`,
			router: studioProxy.router,
			// Harness authenticates with its own launch token and cookies. The
			// studio launch API stays behind project scopes.
			skipAuth: true,
		},
	];

	static attachWebSocketUpgrade(server: Server): void {
		attachStudioProxyUpgrade(server, studioProxy.webService, studioProxy.proxy);
	}
}
