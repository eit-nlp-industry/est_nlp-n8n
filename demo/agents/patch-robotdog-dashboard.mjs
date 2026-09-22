/**
 * Merge Render Dashboard + instruction addendum into the robot-dog agent JSON.
 *
 *   node demo/agents/patch-robotdog-dashboard.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath =
	process.env.ROBOTDOG_AGENT_JSON || path.join(__dirname, 'source-agent.json');
const toolPath = path.join(__dirname, 'render-dashboard.tool.json');
const outPath = path.join(__dirname, '机器狗-加权语义检索-v3-dashboard.json');

const DASHBOARD_MARKER = '【展示看板 render_dashboard】';
const MCP_MARKER = '【真实 MCP 契约 L1-L4】';
const ADDENDUM = readFileSync(path.join(__dirname, 'dashboard-addendum.txt'), 'utf8').trim();

function stripAddendum(instructions) {
	const idx = Math.min(
		...[DASHBOARD_MARKER, MCP_MARKER]
			.map((marker) => instructions.indexOf(marker))
			.filter((i) => i >= 0),
		instructions.length,
	);
	if (idx === instructions.length) return instructions.trimEnd();
	return instructions.slice(0, idx).trimEnd();
}

const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const dashboardTool = JSON.parse(readFileSync(toolPath, 'utf8'));

source.tools = (source.tools ?? []).filter((tool) => tool.name !== 'render_dashboard');
source.tools.push(dashboardTool);
source.instructions = `${stripAddendum(source.instructions)}\n\n${ADDENDUM}\n`;

mkdirSync(__dirname, { recursive: true });
writeFileSync(outPath, `${JSON.stringify(source, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
console.log(`tools: ${source.tools.map((t) => t.name).join(', ')}`);
console.log(`instructions chars: ${source.instructions.length}`);
