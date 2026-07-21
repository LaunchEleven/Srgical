import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type StoredRepositoryHistory = {
  version: 1;
  repositories: RecentRepository[];
};

export type RecentRepository = {
  path: string;
  lastOpenedAt: string;
};

export function getRepositoryHistoryPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".srgical", "repositories.json");
}

export async function loadRecentRepositories(homeDir?: string): Promise<RecentRepository[]> {
  const historyPath = getRepositoryHistoryPath(homeDir);
  try {
    const parsed = JSON.parse(await readFile(historyPath, "utf8")) as Partial<StoredRepositoryHistory>;
    if (!Array.isArray(parsed.repositories)) return [];
    return parsed.repositories
      .filter((entry): entry is RecentRepository => Boolean(
        entry
        && typeof entry === "object"
        && typeof entry.path === "string"
        && entry.path.trim()
        && typeof entry.lastOpenedAt === "string"
      ))
      .map((entry) => ({ path: path.resolve(entry.path), lastOpenedAt: entry.lastOpenedAt }))
      .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw new Error(`Could not read repository history at ${historyPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function recordRecentRepository(repoRoot: string, homeDir?: string): Promise<RecentRepository[]> {
  const resolved = path.resolve(repoRoot);
  const now = new Date().toISOString();
  const existing = await loadRecentRepositories(homeDir);
  const repositories = [
    { path: resolved, lastOpenedAt: now },
    ...existing.filter((entry) => normalizePath(entry.path) !== normalizePath(resolved))
  ].slice(0, 12);
  const historyPath = getRepositoryHistoryPath(homeDir);
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify({ version: 1, repositories } satisfies StoredRepositoryHistory, null, 2)}\n`, "utf8");
  return repositories;
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
