import {
	buildStudioProxyUrl,
	rewriteHarnessApiPaths,
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

	it('rewrites absolute Harness API path literals for subpath hosting', () => {
		const body = `const p="/api"; const q='/api/remote.mux'; const r=\`/api/x\`;`;
		expect(rewriteHarnessApiPaths(body, '/deepseek-harness-studio/p/a')).toBe(
			`const p="/deepseek-harness-studio/p/a/api"; const q='/deepseek-harness-studio/p/a/api/remote.mux'; const r=\`/deepseek-harness-studio/p/a/api/x\`;`,
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
});
