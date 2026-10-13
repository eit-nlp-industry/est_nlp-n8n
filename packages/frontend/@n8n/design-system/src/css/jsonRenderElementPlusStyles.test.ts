import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, Logger } from 'sass';

describe('json-render Element Plus styles', () => {
	it('includes the Steps component styles in the design-system bundle', () => {
		const cssDirectory = resolve(process.cwd(), 'src/css');
		const entrypoint = readFileSync(resolve(cssDirectory, 'index.scss'), 'utf8');
		const result = compile(resolve(cssDirectory, 'steps.scss'), {
			loadPaths: [resolve(process.cwd(), 'src/css'), resolve(process.cwd(), 'node_modules')],
			logger: Logger.silent,
		});

		expect(entrypoint).toContain("@use './steps.scss';");
		expect(result.css).toContain('.el-steps');
		expect(result.css).toContain('.el-step__icon');
	});

	it('maps the Steps theme variables inside json-render panels', () => {
		const result = compile(resolve(process.cwd(), 'src/css/steps.scss'), {
			loadPaths: [resolve(process.cwd(), 'src/css'), resolve(process.cwd(), 'node_modules')],
			logger: Logger.silent,
		});

		expect(result.css).toContain('--el-color-primary: var(--background--brand, #409eff)');
		expect(result.css).toContain(
			'--el-text-color-placeholder: var(--text-color--disabled, #a8abb2)',
		);
		expect(result.css).toContain('--el-bg-color: var(--background--surface, #fff)');
	});
});
