import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensurePreparePack } from "./prepare-pack";
import {
  createGitWorktree,
  getCurrentGitBranch,
  getGitDirtyState,
  listGitWorktrees,
  removeGitWorktree,
  resolveGitRepoContext,
  type GitRepoContext,
  type GitRunner
} from "./git-worktree";
import { fileExists, saveActivePlanId } from "./workspace";
import type { StudioMode } from "@srgical/studio-shared";

export type WorktreeLaneRecord = {
  laneId: string;
  planId: string;
  branchName: string;
  worktreePath: string;
  createdAt: string;
  openedAt: string | null;
  archivedAt: string | null;
  removedAt: string | null;
  lastMode: StudioMode | null;
  deleteLocked: boolean;
  unlockedAt: string | null;
};

type WorktreeLaneRegistry = {
  version: 1;
  updatedAt: string;
  lanes: WorktreeLaneRecord[];
};

export type WorktreeLaneSummary = {
  laneId: string;
  planId: string | null;
  branchName: string | null;
  worktreePath: string;
  workspaceLabel: string;
  dirty: boolean;
  archived: boolean;
  removed: boolean;
  isCurrentCheckout: boolean;
  canRemove: boolean;
  deleteLocked: boolean;
  lastMode: StudioMode | null;
  createdAt: string | null;
  openedAt: string | null;
  unlockedAt: string | null;
  source: "current" | "managed" | "detected";
};

export type CreateWorktreeLaneResult = {
  lane: WorktreeLaneSummary;
  workspace: string;
};

export type WorktreeLaneRepoState = GitRepoContext & {
  lanes: WorktreeLaneSummary[];
};

type WorktreeLaneOptions = {
  gitRunner?: GitRunner;
  now?: () => string;
};

const DEFAULT_BRANCH_PREFIX = "srgical";

export async function resolveWorktreeLaneRepoState(
  workspaceRoot: string,
  options: WorktreeLaneOptions = {}
): Promise<WorktreeLaneRepoState> {
  const context = await resolveGitRepoContext(workspaceRoot, options.gitRunner);
  const lanes = await listWorktreeLanes(context, options);
  return {
    ...context,
    lanes
  };
}

export async function listWorktreeLanes(
  context: GitRepoContext,
  options: WorktreeLaneOptions = {}
): Promise<WorktreeLaneSummary[]> {
  const [registry, worktrees] = await Promise.all([
    loadWorktreeLaneRegistry(context.repoRoot),
    listGitWorktrees(context.currentWorkspace, options.gitRunner)
  ]);
  const byPath = new Map(registry.lanes.filter((lane) => !lane.removedAt).map((lane) => [normalizePathKey(lane.worktreePath), lane]));
  const summaries = await Promise.all(
    worktrees.map(async (entry, index) => {
      const record = byPath.get(normalizePathKey(entry.worktreePath)) ?? null;
      const dirty = await getGitDirtyState(entry.worktreePath, options.gitRunner).catch(() => false);
      const isCurrentCheckout = normalizePathKey(entry.worktreePath) === normalizePathKey(context.currentWorkspace);
      const isMainCheckout = index === 0;

      return {
        laneId: record?.laneId ?? (isMainCheckout ? "current" : sanitizeLaneSegment(path.basename(entry.worktreePath))),
        planId: record?.planId ?? null,
        branchName: record?.branchName ?? entry.branchName ?? null,
        worktreePath: entry.worktreePath,
        workspaceLabel: path.basename(entry.worktreePath) || entry.worktreePath,
        dirty,
        archived: Boolean(record?.archivedAt),
        removed: Boolean(record?.removedAt),
        isCurrentCheckout,
        canRemove: !isMainCheckout && !isCurrentCheckout && !(record?.deleteLocked ?? true),
        deleteLocked: record?.deleteLocked ?? true,
        lastMode: record?.lastMode ?? null,
        createdAt: record?.createdAt ?? null,
        openedAt: record?.openedAt ?? null,
        unlockedAt: record?.unlockedAt ?? null,
        source: record ? "managed" : isMainCheckout ? "current" : "detected"
      } satisfies WorktreeLaneSummary;
    })
  );

  return summaries.sort((left, right) => {
    if (left.isCurrentCheckout !== right.isCurrentCheckout) {
      return left.isCurrentCheckout ? -1 : 1;
    }
    if (left.archived !== right.archived) {
      return left.archived ? 1 : -1;
    }
    return left.laneId.localeCompare(right.laneId);
  });
}

export async function createWorktreeLane(
  workspaceRoot: string,
  options: {
    planId: string;
    mode: StudioMode;
    baseRef?: string;
    gitRunner?: GitRunner;
    now?: () => string;
  }
): Promise<CreateWorktreeLaneResult> {
  const repoState = await resolveWorktreeLaneRepoState(workspaceRoot, options);
  const registry = await loadWorktreeLaneRegistry(repoState.repoRoot);
  const now = (options.now ?? (() => new Date().toISOString()))();
  const activeLaneIds = new Set(registry.lanes.filter((lane) => !lane.removedAt).map((lane) => lane.laneId));
  const laneId = buildUniqueLaneId(options.planId, activeLaneIds);
  const branchName = `${DEFAULT_BRANCH_PREFIX}/${laneId}`;
  const lanePath = path.join(getWorktreeLaneStorageRoot(repoState.repoRoot), laneId);

  await mkdir(getWorktreeLaneStorageRoot(repoState.repoRoot), { recursive: true });
  await createGitWorktree(repoState.repoRoot, lanePath, branchName, {
    baseRef: options.baseRef,
    runner: options.gitRunner
  });
  await ensurePreparePack(lanePath, { planId: options.planId });
  await saveActivePlanId(lanePath, options.planId);

  const record: WorktreeLaneRecord = {
    laneId,
    planId: options.planId,
    branchName,
    worktreePath: lanePath,
    createdAt: now,
    openedAt: now,
    archivedAt: null,
    removedAt: null,
    lastMode: options.mode,
    deleteLocked: true,
    unlockedAt: null
  };
  registry.lanes = [...registry.lanes.filter((lane) => lane.laneId !== laneId), record];
  await saveWorktreeLaneRegistry(repoState.repoRoot, registry, options.now);

  const refreshed = await listWorktreeLanes(repoState, options);
  const lane = refreshed.find((item) => item.laneId === laneId);
  if (!lane) {
    throw new Error(`Created worktree lane \`${laneId}\` but could not read it back.`);
  }

  return {
    lane,
    workspace: lanePath
  };
}

export async function markWorktreeLaneOpened(
  repoRoot: string,
  laneId: string,
  mode: StudioMode,
  now: () => string = () => new Date().toISOString()
): Promise<WorktreeLaneRecord | null> {
  const registry = await loadWorktreeLaneRegistry(repoRoot);
  const lane = registry.lanes.find((entry) => entry.laneId === laneId && !entry.removedAt) ?? null;
  if (!lane) {
    return null;
  }
  lane.openedAt = now();
  lane.lastMode = mode;
  await saveWorktreeLaneRegistry(repoRoot, registry, now);
  return lane;
}

export async function archiveWorktreeLane(repoRoot: string, laneId: string, now: () => string = () => new Date().toISOString()): Promise<void> {
  const registry = await loadWorktreeLaneRegistry(repoRoot);
  const lane = registry.lanes.find((entry) => entry.laneId === laneId && !entry.removedAt);
  if (!lane) {
    throw new Error(`Unknown worktree lane \`${laneId}\`.`);
  }
  lane.archivedAt = now();
  await saveWorktreeLaneRegistry(repoRoot, registry, now);
}

export async function setWorktreeLaneDeleteLock(
  repoRoot: string,
  laneId: string,
  deleteLocked: boolean,
  now: () => string = () => new Date().toISOString()
): Promise<void> {
  const registry = await loadWorktreeLaneRegistry(repoRoot);
  const lane = registry.lanes.find((entry) => entry.laneId === laneId && !entry.removedAt);
  if (!lane) {
    throw new Error(`Unknown worktree lane \`${laneId}\`.`);
  }
  lane.deleteLocked = deleteLocked;
  lane.unlockedAt = deleteLocked ? null : now();
  await saveWorktreeLaneRegistry(repoRoot, registry, now);
}

export async function removeWorktreeLane(
  workspaceRoot: string,
  laneId: string,
  options: {
    gitRunner?: GitRunner;
    now?: () => string;
  } = {}
): Promise<void> {
  const repoState = await resolveWorktreeLaneRepoState(workspaceRoot, options);
  const lane = repoState.lanes.find((entry) => entry.laneId === laneId && !entry.removed);
  if (!lane) {
    throw new Error(`Unknown worktree lane \`${laneId}\`.`);
  }
  if (!lane.canRemove) {
    if (lane.isCurrentCheckout) {
      throw new Error("The current checkout cannot be removed from the web UI.");
    }
    if (lane.deleteLocked) {
      throw new Error(`Worktree lane \`${laneId}\` is locked. Unlock it before deleting.`);
    }
  }

  await removeGitWorktree(repoState.repoRoot, lane.worktreePath, { runner: options.gitRunner, force: true });

  const registry = await loadWorktreeLaneRegistry(repoState.repoRoot);
  const record = registry.lanes.find((entry) => entry.laneId === laneId && !entry.removedAt);
  if (record) {
    record.removedAt = (options.now ?? (() => new Date().toISOString()))();
    await saveWorktreeLaneRegistry(repoState.repoRoot, registry, options.now);
  }
}

export async function loadWorktreeLaneRegistry(repoRoot: string): Promise<WorktreeLaneRegistry> {
  const filePath = getWorktreeLaneRegistryPath(repoRoot);
  if (!(await fileExists(filePath))) {
    return createEmptyRegistry();
  }

  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<WorktreeLaneRegistry>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "1970-01-01T00:00:00.000Z",
      lanes: Array.isArray(parsed.lanes) ? parsed.lanes.map(normalizeLaneRecord).filter((lane): lane is WorktreeLaneRecord => lane !== null) : []
    };
  } catch {
    return createEmptyRegistry();
  }
}

export async function saveWorktreeLaneRegistry(
  repoRoot: string,
  registry: WorktreeLaneRegistry,
  now: () => string = () => new Date().toISOString()
): Promise<void> {
  const filePath = getWorktreeLaneRegistryPath(repoRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: now(),
        lanes: registry.lanes
      } satisfies WorktreeLaneRegistry,
      null,
      2
    ),
    "utf8"
  );
}

export function getWorktreeLaneRegistryPath(repoRoot: string): string {
  return path.join(repoRoot, ".srgical", "worktree-lanes.json");
}

export function getWorktreeLaneStorageRoot(repoRoot: string): string {
  return path.join(path.dirname(repoRoot), ".srgical-worktrees", path.basename(repoRoot));
}

export function buildUniqueLaneId(planId: string, existingLaneIds: Set<string>): string {
  const base = sanitizeLaneSegment(planId) || "lane";
  if (!existingLaneIds.has(base)) {
    return base;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index.toString(36)}`;
    if (!existingLaneIds.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not allocate a unique lane id for plan \`${planId}\`.`);
}

export function sanitizeLaneSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function resolveLaneWorkspacePath(workspaceRoot: string, laneId: string, options: WorktreeLaneOptions = {}): Promise<string | null> {
  const repoState = await resolveWorktreeLaneRepoState(workspaceRoot, options);
  const lane = repoState.lanes.find((entry) => entry.laneId === laneId && !entry.removed);
  return lane?.worktreePath ?? null;
}

export async function getLaneBranchName(workspaceRoot: string, laneId: string, options: WorktreeLaneOptions = {}): Promise<string | null> {
  const repoState = await resolveWorktreeLaneRepoState(workspaceRoot, options);
  const lane = repoState.lanes.find((entry) => entry.laneId === laneId && !entry.removed);
  return lane?.branchName ?? null;
}

export async function getWorkspaceBranchName(workspaceRoot: string, runner?: GitRunner): Promise<string | null> {
  return getCurrentGitBranch(workspaceRoot, runner);
}

function createEmptyRegistry(): WorktreeLaneRegistry {
  return {
    version: 1,
    updatedAt: "1970-01-01T00:00:00.000Z",
    lanes: []
  };
}

function normalizeLaneRecord(value: unknown): WorktreeLaneRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<WorktreeLaneRecord>;
  if (
    typeof candidate.laneId !== "string" ||
    typeof candidate.planId !== "string" ||
    typeof candidate.branchName !== "string" ||
    typeof candidate.worktreePath !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  return {
    laneId: candidate.laneId,
    planId: candidate.planId,
    branchName: candidate.branchName,
    worktreePath: candidate.worktreePath,
    createdAt: candidate.createdAt,
    openedAt: typeof candidate.openedAt === "string" ? candidate.openedAt : null,
    archivedAt: typeof candidate.archivedAt === "string" ? candidate.archivedAt : null,
    removedAt: typeof candidate.removedAt === "string" ? candidate.removedAt : null,
    lastMode: candidate.lastMode === "prepare" || candidate.lastMode === "operate" ? candidate.lastMode : null,
    deleteLocked: typeof candidate.deleteLocked === "boolean" ? candidate.deleteLocked : true,
    unlockedAt: typeof candidate.unlockedAt === "string" ? candidate.unlockedAt : null
  };
}

function normalizePathKey(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}
