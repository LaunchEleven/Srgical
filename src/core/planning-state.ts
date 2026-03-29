import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

export type PlanningPackMode = "scaffolded" | "authored";

export type PlanningStateFile = {
  version: 1;
  planId: string;
  createdAt: string;
  updatedAt: string;
  packMode: PlanningPackMode;
  humanConfirmedForWriteAt: string | null;
};

export async function loadPlanningState(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<PlanningStateFile | null> {
  const paths = getPlanningPackPaths(workspaceRoot, options);

  if (!(await fileExists(paths.planningState))) {
    return null;
  }

  try {
    const parsed = JSON.parse(await readText(paths.planningState)) as Partial<PlanningStateFile>;

    if (
      parsed.version !== 1 ||
      typeof parsed.planId !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.updatedAt !== "string" ||
      (parsed.packMode !== "scaffolded" && parsed.packMode !== "authored") ||
      (typeof parsed.humanConfirmedForWriteAt !== "string" && parsed.humanConfirmedForWriteAt !== null && parsed.humanConfirmedForWriteAt !== undefined)
    ) {
      return null;
    }

    return {
      version: 1,
      planId: parsed.planId,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      packMode: parsed.packMode,
      humanConfirmedForWriteAt: parsed.humanConfirmedForWriteAt ?? null
    };
  } catch {
    return null;
  }
}

export async function savePlanningState(
  workspaceRoot: string,
  packMode: PlanningPackMode,
  options: PlanningPathOptions = {}
): Promise<PlanningStateFile> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const existing = await loadPlanningState(workspaceRoot, options);
  const now = new Date().toISOString();
  const state: PlanningStateFile = {
    version: 1,
    planId: paths.planId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    packMode,
    humanConfirmedForWriteAt: existing?.humanConfirmedForWriteAt ?? null
  };

  await writeText(paths.planningState, JSON.stringify(state, null, 2));
  return state;
}

export async function markPlanningPackAuthored(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<PlanningStateFile> {
  await savePlanningState(workspaceRoot, "authored", options);
  return setHumanWriteConfirmation(workspaceRoot, false, options);
}

export async function ensurePlanningPackState(
  workspaceRoot: string,
  packMode: PlanningPackMode,
  options: PlanningPathOptions = {}
): Promise<PlanningStateFile> {
  const existing = await loadPlanningState(workspaceRoot, options);

  if (existing) {
    return existing;
  }

  return savePlanningState(workspaceRoot, packMode, options);
}

export async function setHumanWriteConfirmation(
  workspaceRoot: string,
  confirmed: boolean,
  options: PlanningPathOptions = {}
): Promise<PlanningStateFile> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const existing = await loadPlanningState(workspaceRoot, options);
  const now = new Date().toISOString();
  const state: PlanningStateFile = {
    version: 1,
    planId: paths.planId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    packMode: existing?.packMode ?? "scaffolded",
    humanConfirmedForWriteAt: confirmed ? now : null
  };

  await writeText(paths.planningState, JSON.stringify(state, null, 2));
  return state;
}

export function hasHumanWriteConfirmation(state: PlanningStateFile | null): boolean {
  return Boolean(state?.humanConfirmedForWriteAt);
}

export function inferLegacyPackMode(position: {
  lastCompleted: string | null;
  nextRecommended: string | null;
}): PlanningPackMode {
  return position.lastCompleted === "BOOT-001" && position.nextRecommended === "PLAN-001" ? "scaffolded" : "authored";
}
