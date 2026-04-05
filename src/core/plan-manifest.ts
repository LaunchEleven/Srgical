import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

export type PlanStage = "discover" | "draft" | "ready" | "executing" | "blocked" | "finished" | "out_of_date";
export type ExecutionMode = "step" | "auto" | "checkpoint";

export type PlanStepCounts = {
  todo: number;
  doing: number;
  blocked: number;
  done: number;
  skipped: number;
  total: number;
};

export type PlanManifest = {
  version: 1;
  planId: string;
  updatedAt: string;
  stage: PlanStage;
  nextAction: string;
  nextStepId: string | null;
  revision: number;
  stepCounts: PlanStepCounts;
  executionMode: ExecutionMode;
  lastPreparedAt: string | null;
  lastOperatedAt: string | null;
  lastRefinedAt: string | null;
  lastChangeSummary: string | null;
  evidence: string[];
  unknowns: string[];
  contextReady: boolean;
  approvedAt: string | null;
};

export type ManifestStepLike = {
  status: string;
};

const EMPTY_STEP_COUNTS: PlanStepCounts = {
  todo: 0,
  doing: 0,
  blocked: 0,
  done: 0,
  skipped: 0,
  total: 0
};

export async function loadPlanManifest(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<PlanManifest | null> {
  const paths = getPlanningPackPaths(workspaceRoot, options);

  if (!(await fileExists(paths.manifest))) {
    return null;
  }

  try {
    return normalizePlanManifest(JSON.parse(await readText(paths.manifest)), paths.planId);
  } catch {
    return null;
  }
}

export async function ensurePlanManifest(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<PlanManifest> {
  const existing = await loadPlanManifest(workspaceRoot, options);

  if (existing) {
    return existing;
  }

  return savePlanManifest(workspaceRoot, createDefaultManifest(getPlanningPackPaths(workspaceRoot, options).planId), options);
}

export async function savePlanManifest(
  workspaceRoot: string,
  manifest: PlanManifest,
  options: PlanningPathOptions = {}
): Promise<PlanManifest> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const normalized = normalizePlanManifest(manifest, paths.planId) ?? createDefaultManifest(paths.planId);
  await writeText(paths.manifest, JSON.stringify(normalized, null, 2));
  return normalized;
}

export async function updatePlanManifest(
  workspaceRoot: string,
  updates: Partial<Omit<PlanManifest, "version" | "planId" | "updatedAt">>,
  options: PlanningPathOptions = {}
): Promise<PlanManifest> {
  const current = await ensurePlanManifest(workspaceRoot, options);
  return savePlanManifest(
    workspaceRoot,
    {
      ...current,
      ...updates,
      version: 1,
      planId: current.planId,
      updatedAt: new Date().toISOString(),
      stepCounts: normalizeStepCounts(updates.stepCounts ?? current.stepCounts),
      evidence: sanitizeList(updates.evidence ?? current.evidence),
      unknowns: sanitizeList(updates.unknowns ?? current.unknowns)
    },
    options
  );
}

export function createDefaultManifest(planId: string): PlanManifest {
  return {
    version: 1,
    planId,
    updatedAt: new Date().toISOString(),
    stage: "discover",
    nextAction: "Gather more evidence or describe the outcome you want before building the first draft.",
    nextStepId: null,
    revision: 0,
    stepCounts: { ...EMPTY_STEP_COUNTS },
    executionMode: "step",
    lastPreparedAt: null,
    lastOperatedAt: null,
    lastRefinedAt: null,
    lastChangeSummary: "Created a new prepare pack.",
    evidence: [],
    unknowns: ["Desired outcome not confirmed yet.", "Execution slices have not been prepared yet."],
    contextReady: false,
    approvedAt: null
  };
}

export function buildStepCountsFromRows(rows: ManifestStepLike[]): PlanStepCounts {
  const counts: PlanStepCounts = {
    ...EMPTY_STEP_COUNTS
  };

  for (const row of rows) {
    const status = row.status.trim().toLowerCase();

    if (status === "todo") {
      counts.todo += 1;
    } else if (status === "doing") {
      counts.doing += 1;
    } else if (status === "blocked") {
      counts.blocked += 1;
    } else if (status === "done") {
      counts.done += 1;
    } else if (status === "skipped") {
      counts.skipped += 1;
    }
  }

  counts.total = counts.todo + counts.doing + counts.blocked + counts.done + counts.skipped;
  return counts;
}

export function formatPlanStage(stage: PlanStage): string {
  switch (stage) {
    case "discover":
      return "Discover";
    case "draft":
      return "Prepare";
    case "ready":
      return "Ready";
    case "executing":
      return "Execute";
    case "blocked":
      return "Blocked";
    case "finished":
      return "Finished";
    case "out_of_date":
      return "Out of Date";
  }
}

function normalizePlanManifest(value: unknown, fallbackPlanId: string): PlanManifest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PlanManifest>;
  const stage = normalizeStage(candidate.stage);
  const executionMode = normalizeExecutionMode(candidate.executionMode);

  if (
    candidate.version !== 1 ||
    !stage ||
    !executionMode ||
    typeof candidate.nextAction !== "string" ||
    typeof candidate.revision !== "number"
  ) {
    return null;
  }

  return {
    version: 1,
    planId: typeof candidate.planId === "string" ? candidate.planId : fallbackPlanId,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
    stage,
    nextAction: candidate.nextAction.trim(),
    nextStepId: typeof candidate.nextStepId === "string" && candidate.nextStepId.trim().length > 0 ? candidate.nextStepId.trim() : null,
    revision: Number.isFinite(candidate.revision) ? Math.max(0, Math.floor(candidate.revision)) : 0,
    stepCounts: normalizeStepCounts(candidate.stepCounts),
    executionMode,
    lastPreparedAt: normalizeNullableString(candidate.lastPreparedAt),
    lastOperatedAt: normalizeNullableString(candidate.lastOperatedAt),
    lastRefinedAt: normalizeNullableString(candidate.lastRefinedAt),
    lastChangeSummary: normalizeNullableString(candidate.lastChangeSummary),
    evidence: sanitizeList(candidate.evidence),
    unknowns: sanitizeList(candidate.unknowns),
    contextReady: Boolean(candidate.contextReady),
    approvedAt: normalizeNullableString(candidate.approvedAt)
  };
}

function normalizeStepCounts(value: unknown): PlanStepCounts {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_STEP_COUNTS };
  }

  const candidate = value as Partial<PlanStepCounts>;
  const todo = normalizeCount(candidate.todo);
  const doing = normalizeCount(candidate.doing);
  const blocked = normalizeCount(candidate.blocked);
  const done = normalizeCount(candidate.done);
  const skipped = normalizeCount(candidate.skipped);

  return {
    todo,
    doing,
    blocked,
    done,
    skipped,
    total: todo + doing + blocked + done + skipped
  };
}

function normalizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function normalizeStage(value: unknown): PlanStage | null {
  return value === "discover" ||
    value === "draft" ||
    value === "ready" ||
    value === "executing" ||
    value === "blocked" ||
    value === "finished" ||
    value === "out_of_date"
    ? value
    : null;
}

function normalizeExecutionMode(value: unknown): ExecutionMode | null {
  return value === "step" || value === "auto" || value === "checkpoint" ? value : null;
}

function sanitizeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const items: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalized = item.replace(/\s+/g, " ").trim();

    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push(normalized);
  }

  return items;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
