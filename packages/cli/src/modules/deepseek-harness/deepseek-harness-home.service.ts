import { DeepSeekHarnessConfig } from '@n8n/config';
import { Service } from '@n8n/di';
import type { Dirent } from 'node:fs';
import { lstat, mkdir, readdir, realpath, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function resolveHome(value: string): string {
	if (value === '~') return homedir();
	if (value.startsWith('~/') || value.startsWith('~\\')) {
		return path.join(homedir(), value.slice(2));
	}
	return path.resolve(value);
}

function resolveSegment(value: string): string {
	if (/[\\/]/.test(value)) {
		throw new Error('Invalid DeepSeek Harness path segment');
	}

	const segment = value
		.trim()
		.replace(/[<>:"/\\|?*]/g, '_')
		.replace(/[. ]+$/, '');

	if (!segment || segment === '.' || segment === '..') {
		throw new Error('Invalid DeepSeek Harness path segment');
	}

	return segment;
}

export const DEFAULT_WORKSPACE_NAME = 'empty-workspace';
const STAGED_HOME_PATTERN = /\.deleting-[0-9a-f-]+$/i;

export type DeepSeekHarnessWorkspace = { id: string; name: string };
export type StagedDeepSeekHarnessHome = { originalPath: string; stagedPath: string };

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileNotFoundError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isWorkspaceRecord(
	value: unknown,
): value is JsonObject & { path: string; sessionIds: string[] } {
	return (
		isJsonObject(value) &&
		typeof value.path === 'string' &&
		Array.isArray(value.sessionIds) &&
		value.sessionIds.every((id) => typeof id === 'string')
	);
}

@Service()
export class DeepSeekHarnessHomeService {
	constructor(private readonly config: DeepSeekHarnessConfig) {}

	getHome(userName: string, agentName: string, agentId: string): string {
		const userSegment = resolveSegment(userName);
		const agentSegment = resolveSegment(agentName);
		const idSegment = resolveSegment(agentId);

		return path.join(resolveHome(this.config.home), userSegment, `${agentSegment}-${idSegment}`);
	}

	async createDefaultWorkspace(
		userName: string,
		agentName: string,
		agentId: string,
	): Promise<string> {
		const workspace = path.join(this.getHome(userName, agentName, agentId), DEFAULT_WORKSPACE_NAME);
		await mkdir(workspace, { recursive: true });
		return workspace;
	}

	async createHome(userName: string, agentName: string, agentId: string): Promise<string> {
		const home = this.getHome(userName, agentName, agentId);
		await mkdir(home, { recursive: true });
		return home;
	}

	async listWorkspaces(
		userName: string,
		agentName: string,
		agentId: string,
	): Promise<DeepSeekHarnessWorkspace[]> {
		const workspaceFile = path.join(
			this.getHome(userName, agentName, agentId),
			'storages',
			'workspace.json',
		);
		let document: unknown;
		try {
			document = JSON.parse(await readFile(workspaceFile, 'utf8')) as unknown;
		} catch {
			return [{ id: DEFAULT_WORKSPACE_NAME, name: DEFAULT_WORKSPACE_NAME }];
		}
		if (!isJsonObject(document) || !isJsonObject(document.tables)) {
			return [{ id: DEFAULT_WORKSPACE_NAME, name: DEFAULT_WORKSPACE_NAME }];
		}
		const table = document.tables.workspaces;
		if (!isJsonObject(table)) return [{ id: DEFAULT_WORKSPACE_NAME, name: DEFAULT_WORKSPACE_NAME }];
		const global = isJsonObject(document.global) ? document.global.workspaceIds : undefined;
		const ids = Array.isArray(global)
			? global.filter((id): id is string => typeof id === 'string')
			: Object.keys(table);
		const workspaces = ids.flatMap((id) => {
			const workspace = table[id];
			if (!isJsonObject(workspace) || typeof workspace.path !== 'string') return [];
			const name =
				typeof workspace.title === 'string' && workspace.title.trim()
					? workspace.title
					: path.basename(workspace.path);
			return [{ id, name }];
		});
		return workspaces.length > 0
			? workspaces
			: [{ id: DEFAULT_WORKSPACE_NAME, name: DEFAULT_WORKSPACE_NAME }];
	}

	async removeHome(userName: string, agentName: string, agentId: string): Promise<void> {
		const userRoot = path.join(resolveHome(this.config.home), resolveSegment(userName));
		const currentHome = this.getHome(userName, agentName, agentId);
		const entries = await readdir(userRoot, { withFileTypes: true }).catch((): Dirent[] => []);
		const profileSuffix = `-${agentId}`;
		await Promise.all(
			entries
				.filter((entry) => entry.name.endsWith(profileSuffix))
				.map(
					async (entry) =>
						await rm(path.join(userRoot, entry.name), { recursive: true, force: true }),
				),
		);
		await rm(currentHome, { recursive: true, force: true });
	}

	async stageHomeForDeletion(
		userName: string,
		agentName: string,
		agentId: string,
	): Promise<StagedDeepSeekHarnessHome[]> {
		const userRoot = path.join(resolveHome(this.config.home), resolveSegment(userName));
		const currentHome = this.getHome(userName, agentName, agentId);
		const entries = await readdir(userRoot, { withFileTypes: true }).catch((): Dirent[] => []);
		const candidates = entries
			.filter((entry) => entry.name.endsWith(`-${agentId}`))
			.map((entry) => path.join(userRoot, entry.name));
		if (!candidates.includes(currentHome) && (await lstat(currentHome).catch(() => undefined))) {
			candidates.push(currentHome);
		}

		const staged: StagedDeepSeekHarnessHome[] = [];
		try {
			for (const originalPath of candidates) {
				const stagedPath = `${originalPath}.deleting-${randomUUID()}`;
				await rename(originalPath, stagedPath);
				staged.push({ originalPath, stagedPath });
			}
			return staged;
		} catch (error) {
			try {
				await this.restoreStagedHomes(staged);
			} catch (rollbackError) {
				throw new Error('DeepSeek Harness home staging failed and rollback was incomplete', {
					cause: new AggregateError([error, rollbackError]),
				});
			}
			throw error;
		}
	}

	async cleanupStagedHomes(): Promise<number> {
		const root = resolveHome(this.config.home);
		const removed: string[] = [];
		const failed: Array<{ path: string; error: unknown }> = [];
		const userRoots: Dirent[] = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
			if (isFileNotFoundError(error)) return [];
			throw error;
		});

		for (const userRoot of userRoots.filter(
			(entry) => entry.isDirectory() && entry.name !== 'agents',
		)) {
			const directories: Dirent[] = await readdir(path.join(root, userRoot.name), { withFileTypes: true }).catch(
				(error: unknown) => {
					if (isFileNotFoundError(error)) return [];
					throw error;
				},
			);
			for (const entry of directories) {
				if (
					!STAGED_HOME_PATTERN.test(entry.name) ||
					(!entry.isDirectory() && !entry.isSymbolicLink())
				)
					continue;
				const target = path.join(root, userRoot.name, entry.name);
				try {
					await rm(target, { recursive: true, force: true });
					removed.push(target);
				} catch (error) {
					failed.push({ path: target, error });
				}
			}
		}

		const legacyRoot = path.join(root, 'agents');
		const legacyEntries = await readdir(legacyRoot, { withFileTypes: true }).catch((error: unknown) => {
			if (isFileNotFoundError(error)) return [];
			throw error;
		});
		for (const entry of legacyEntries) {
			if (
				!STAGED_HOME_PATTERN.test(entry.name) ||
				(!entry.isDirectory() && !entry.isSymbolicLink())
			)
				continue;
			const target = path.join(legacyRoot, entry.name);
			try {
				await rm(target, { recursive: true, force: true });
				removed.push(target);
			} catch (error) {
				failed.push({ path: target, error });
			}
		}

		if (failed.length > 0) {
			throw new AggregateError(
				failed.map(({ error }) => error),
				`Failed to clean ${failed.length} staged DeepSeek Harness home(s)`,
			);
		}
		return removed.length;
	}

	async restoreStagedHomes(staged: StagedDeepSeekHarnessHome[]): Promise<void> {
		for (const { originalPath, stagedPath } of [...staged].reverse()) {
			await rename(stagedPath, originalPath);
		}
	}

	async removeStagedHomes(staged: StagedDeepSeekHarnessHome[]): Promise<void> {
		await Promise.all(staged.map(async ({ stagedPath }) => await rm(stagedPath, { recursive: true, force: true })));
	}

	async stageLegacyHomeForDeletion(agentId: string): Promise<StagedDeepSeekHarnessHome[]> {
		const originalPath = path.join(resolveHome(this.config.home), 'agents', resolveSegment(agentId));
		if (!(await lstat(originalPath).catch(() => undefined))) return [];
		const stagedPath = `${originalPath}.deleting-${randomUUID()}`;
		await rename(originalPath, stagedPath);
		return [{ originalPath, stagedPath }];
	}

	async migrateWorkspacePaths(oldHome: string, newHome: string, agentId: string): Promise<void> {
		const oldWorkspaceFile = path.join(oldHome, 'storages', 'workspace.json');
		const newWorkspaceFile = path.join(newHome, 'storages', 'workspace.json');
		const workspaceFile = await realpath(oldWorkspaceFile).catch(
			async () => await realpath(newWorkspaceFile).catch(() => undefined),
		);
		if (!workspaceFile) return;
		let document: unknown;
		try {
			document = JSON.parse(await readFile(workspaceFile, 'utf8')) as unknown;
		} catch (error) {
			if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
				return;
			throw error;
		}

		const records: Array<{
			record: JsonObject & { path: string; sessionIds: string[] };
			parent: JsonObject | unknown[];
			key: string;
		}> = [];
		const visit = (value: unknown, parent?: JsonObject | unknown[], key?: string): void => {
			if (isWorkspaceRecord(value) && parent !== undefined && key !== undefined) {
				records.push({ record: value, parent, key });
			}
			if (Array.isArray(value)) {
				value.forEach((item, index) => visit(item, value, String(index)));
			} else if (isJsonObject(value)) {
				Object.entries(value).forEach(([childKey, child]) => visit(child, value, childKey));
			}
		};
		visit(document);

		const oldRoot = path.resolve(oldHome);
		const newRoot = path.resolve(newHome);
		const profileParent = path.dirname(oldRoot);
		const migrated: Array<{
			id: string;
			record: JsonObject & { path: string; sessionIds: string[] };
			target: string;
			wasAtTarget: boolean;
		}> = [];
		for (const [index, entry] of records.entries()) {
			const recordPath = path.resolve(entry.record.path);
			const relative = path.relative(oldRoot, recordPath);
			const currentProfileRoot = path.dirname(recordPath);
			const isCurrentProfile = !relative.startsWith('..') && !path.isAbsolute(relative);
			const isHistoricalProfile =
				path.dirname(currentProfileRoot) === profileParent &&
				path.basename(currentProfileRoot).endsWith(`-${agentId}`);
			if (!isCurrentProfile && !isHistoricalProfile) continue;
			const workspaceRelativePath = isCurrentProfile
				? relative
				: path.relative(currentProfileRoot, recordPath);
			const target = path.join(newRoot, workspaceRelativePath);
			const wasAtTarget =
				path.resolve(recordPath).toLowerCase() === path.resolve(target).toLowerCase();
			if (!wasAtTarget) entry.record.path = target;
			migrated.push({ id: entry.key || String(index), record: entry.record, target, wasAtTarget });
		}

		const groups = new Map<string, typeof migrated>();
		for (const entry of migrated) {
			const group = groups.get(path.resolve(entry.target).toLowerCase()) ?? [];
			group.push(entry);
			groups.set(path.resolve(entry.target).toLowerCase(), group);
		}
		for (const group of groups.values()) {
			const winner = group.find((entry) => entry.wasAtTarget) ?? group[0];
			if (!winner) continue;
			const duplicates = group.filter((entry) => entry !== winner);
			for (const duplicate of duplicates) {
				winner.record.sessionIds = [
					...winner.record.sessionIds,
					...duplicate.record.sessionIds.filter((id) => !winner.record.sessionIds.includes(id)),
				];
				const duplicateEntry = records.find((entry) => entry.record === duplicate.record);
				if (duplicateEntry) {
					if (Array.isArray(duplicateEntry.parent)) {
						duplicateEntry.parent.splice(Number(duplicateEntry.key), 1);
					} else {
						delete duplicateEntry.parent[duplicateEntry.key];
					}
				}
				this.removeWorkspaceId(document, duplicate.id);
			}
		}

		await writeFile(workspaceFile, JSON.stringify(document, null, 2) + '\n', 'utf8');
	}

	private removeWorkspaceId(value: unknown, workspaceId: string): void {
		if (Array.isArray(value)) {
			for (let index = value.length - 1; index >= 0; index--) {
				if (value[index] === workspaceId) value.splice(index, 1);
				else this.removeWorkspaceId(value[index], workspaceId);
			}
		} else if (isJsonObject(value)) {
			for (const [key, child] of Object.entries(value)) {
				if (key === 'workspaceIds' && Array.isArray(child)) {
					value[key] = child.filter((id) => id !== workspaceId);
				} else {
					this.removeWorkspaceId(child, workspaceId);
				}
			}
		}
	}

	async renameHome(
		userName: string,
		oldAgentName: string,
		newAgentName: string,
		agentId: string,
	): Promise<void> {
		const oldHome = this.getHome(userName, oldAgentName, agentId);
		const newHome = this.getHome(userName, newAgentName, agentId);
		const sourceHome = await realpath(oldHome).catch(() => oldHome);
		if (sourceHome !== oldHome) await rm(oldHome, { recursive: true, force: true });
		const existingTarget = await lstat(newHome).catch(() => undefined);
		if (existingTarget?.isSymbolicLink()) await rm(newHome, { recursive: true, force: true });
		if (existingTarget && !existingTarget.isSymbolicLink()) {
			throw new Error(`DeepSeek Harness target home already exists: ${newHome}`);
		}
		await rename(sourceHome, newHome);
	}

	async removeLegacyHome(agentId: string): Promise<void> {
		await rm(path.join(resolveHome(this.config.home), 'agents', resolveSegment(agentId)), {
			recursive: true,
			force: true,
		});
	}
}
