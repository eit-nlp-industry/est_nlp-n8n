import { existsSync } from 'node:fs';
import { resolve } from 'path';
import type { Alias } from 'vite';

// `@n8n/frontend-vite-config` holds the part that modules also use. Each module needs the same
// map for its own vitest run. A module must not import from the shell.
import { shellAliases } from '@n8n/frontend-vite-config';

export const jsonRenderRoot = (editorUiDir: string): string =>
	resolve(editorUiDir, '../../../../eit-json-render');

export const jsonRenderAliases = (editorUiDir: string): Alias[] => {
	const root = jsonRenderRoot(editorUiDir);
	if (!existsSync(root)) return [];
	return [
		{
			find: '@eit/json-render-protocol',
			replacement: resolve(root, 'packages/protocol/src/index.ts'),
		},
		{
			find: '@eit/json-render-vue',
			replacement: resolve(root, 'packages/vue/src/index.ts'),
		},
		{
			find: '@eit/json-render-element-plus',
			replacement: resolve(root, 'packages/element-plus/src/index.ts'),
		},
	];
};

export const appAliases = (editorUiDir: string): Alias[] => [
	{ find: '@', replacement: resolve(editorUiDir, 'src') },
	// Stub out @n8n/expression-runtime for browser build (it pulls in isolated-vm, a Node.js-only native module)
	{
		find: '@n8n/expression-runtime',
		replacement: resolve(editorUiDir, 'vite/expression-runtime-stub.ts'),
	},
	{
		// For sanitize-html
		find: 'source-map-js',
		replacement: resolve(editorUiDir, 'vite/source-map-js-shim'),
	},
	...jsonRenderAliases(editorUiDir),
];

export const editorUiAliases = (editorUiDir: string, packagesDir: string): Alias[] => [
	...appAliases(editorUiDir),
	...shellAliases(packagesDir),
];
