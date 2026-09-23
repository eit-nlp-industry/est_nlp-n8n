import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { DeepSeekHarnessConfig } from '@n8n/config';
import { jsonParse } from 'n8n-workflow';

import { DeepSeekHarnessHomeService } from '../deepseek-harness-home.service';

describe('DeepSeekHarnessHomeService', () => {
	it('lists registered workspaces from the profile storage', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);
		const home = service.getHome('user@example.com', 'Agent', 'agent-1');
		const workspaceFile = path.join(home, 'storages', 'workspace.json');
		await mkdir(path.dirname(workspaceFile), { recursive: true });
		await writeFile(
			workspaceFile,
			JSON.stringify({
				tables: {
					workspaces: {
						first: { path: path.join(home, 'empty-workspace'), title: 'empty-workspace', sessionIds: [] },
						second: { path: path.join(home, 'research'), title: 'Research', sessionIds: [] },
					},
				},
				global: { workspaceIds: ['first', 'second'] },
			}),
		);

		expect(await service.listWorkspaces('user@example.com', 'Agent', 'agent-1')).toEqual([
			{ id: 'first', name: 'empty-workspace' },
			{ id: 'second', name: 'Research' },
		]);
	});
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'n8n-dsh-'));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('derives and creates an isolated home below the configured root', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);

		expect(service.getHome('user@example.com', 'Research agent', 'agent-1')).toBe(
			path.join(root, 'user@example.com', 'Research agent-agent-1'),
		);
		expect(await service.createHome('user@example.com', 'Research agent', 'agent-1')).toBe(
			path.join(root, 'user@example.com', 'Research agent-agent-1'),
		);
	});

	it('creates the default empty workspace below the isolated home', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);

		const workspace = await service.createDefaultWorkspace('user@example.com', 'Agent', 'agent-1');

		expect(workspace).toBe(path.join(root, 'user@example.com', 'Agent-agent-1', 'empty-workspace'));
		await expect(access(workspace)).resolves.toBeUndefined();
	});

	it('moves the profile without leaving a compatibility link after renaming', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);
		const oldHome = await service.createHome('user@example.com', 'Old agent', 'agent-1');
		const marker = path.join(oldHome, 'marker.txt');
		await mkdir(oldHome, { recursive: true });
		await writeFile(marker, 'marker');
		await access(oldHome);

		await service.renameHome('user@example.com', 'Old agent', 'New agent', 'agent-1');

		const newHome = service.getHome('user@example.com', 'New agent', 'agent-1');
		await expect(access(newHome)).resolves.toBeUndefined();
		await expect(access(oldHome)).rejects.toThrow();
		await expect(access(path.join(newHome, 'marker.txt'))).resolves.toBeUndefined();
	});

	it('removes renamed profile directories when deleting the current profile', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);
		const oldHome = await service.createHome('user@example.com', 'Old agent', 'agent-1');
		await mkdir(oldHome, { recursive: true });
		await service.renameHome('user@example.com', 'Old agent', 'New agent', 'agent-1');

		await service.removeHome('user@example.com', 'New agent', 'agent-1');

		await expect(access(oldHome)).rejects.toThrow();
		await expect(access(service.getHome('user@example.com', 'New agent', 'agent-1'))).rejects.toThrow();
	});

	it('migrates and merges persisted workspace records without Harness changes', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);
		const oldHome = service.getHome('user@example.com', 'Old agent', 'agent-1');
		const newHome = service.getHome('user@example.com', 'New agent', 'agent-1');
		const oldWorkspace = path.join(oldHome, 'empty-workspace');
		const newWorkspace = path.join(newHome, 'empty-workspace');
		const file = path.join(oldHome, 'storages', 'workspace.json');
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, JSON.stringify({
			tables: {
				workspaces: {
					old: { path: oldWorkspace, sessionIds: ['old-session'] },
					current: { path: newWorkspace, sessionIds: ['new-session'] },
				},
			},
			global: { workspaceIds: ['old', 'current'] },
		}));

		await service.migrateWorkspacePaths(oldHome, newHome, 'agent-1');

		const persisted = jsonParse<{
			tables: { workspaces: Record<string, { path: string; sessionIds: string[] }> };
			global: { workspaceIds: string[] };
		}>(await readFile(file, 'utf8'));
		expect(persisted.tables.workspaces.current).toEqual({
			path: newWorkspace,
			sessionIds: ['new-session', 'old-session'],
		});
		expect(persisted.tables.workspaces.old).toBeUndefined();
		expect(persisted.global.workspaceIds).toEqual(['current']);
	});

	it('migrates workspace paths after the profile directory has moved', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);
		const oldHome = service.getHome('user@example.com', 'Old agent', 'agent-1');
		const oldWorkspace = path.join(oldHome, 'empty-workspace');
		const file = path.join(oldHome, 'storages', 'workspace.json');
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(
			file,
			JSON.stringify({
				tables: { workspaces: { workspace: { path: oldWorkspace, sessionIds: [] } } },
				global: { workspaceIds: ['workspace'] },
			}),
		);

		await service.renameHome('user@example.com', 'Old agent', 'New agent', 'agent-1');
		const newHome = service.getHome('user@example.com', 'New agent', 'agent-1');
		await service.migrateWorkspacePaths(oldHome, newHome, 'agent-1');

		const persisted = jsonParse<{ tables: { workspaces: Record<string, { path: string }> } }>(
			await readFile(path.join(newHome, 'storages', 'workspace.json'), 'utf8'),
		);
		expect(persisted.tables.workspaces.workspace.path).toBe(path.join(newHome, 'empty-workspace'));
	});

	it('rejects path traversal in a profile path segment', () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);

		expect(() => service.getHome('../other', 'Agent', 'agent-1')).toThrow(
			'Invalid DeepSeek Harness path segment',
		);
	});

	it('removes a legacy profile home below the old agents directory', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);
		const legacyHome = path.join(root, 'agents', 'agent-1');

		await mkdir(legacyHome, { recursive: true });
		await service.removeLegacyHome('agent-1');

		await expect(access(legacyHome)).rejects.toThrow();
	});

	it('cleans staged profile homes left by an interrupted delete', async () => {
		const service = new DeepSeekHarnessHomeService({ home: root } as DeepSeekHarnessConfig);
		const userRoot = path.join(root, 'user@example.com');
		const legacyRoot = path.join(root, 'agents');
		const stagedProfile = path.join(userRoot, 'Agent-agent-1.deleting-123');
		const stagedLegacy = path.join(legacyRoot, 'agent-2.deleting-456');
		await mkdir(stagedProfile, { recursive: true });
		await mkdir(stagedLegacy, { recursive: true });

		expect(await service.cleanupStagedHomes()).toBe(2);
		await expect(access(stagedProfile)).rejects.toThrow();
		await expect(access(stagedLegacy)).rejects.toThrow();
	});
});
