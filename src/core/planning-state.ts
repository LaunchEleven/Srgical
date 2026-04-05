import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

export type PlanningPackMode = "scaffolded" | "authored";
export type PlanningDraftState = "scaffolded" | "written" | "sliced";
export type PlanningApprovalStatus = "pending" | "approved" | "stale";
export type PlanningApprovalInvalidationReason = "write" | "dice";

export type PlanningStateFile = {
  version: 2;
  planId: string;
  createdAt: string;
  updatedAt: string;
  packMode: PlanningPackMode;
  humanConfirmedForWriteAt: string | null;
  draftState: PlanningDraftState;
  approvalStatus: PlanningApprovalStatus;
  approvalInvalidatedBy: PlanningApprovalInvalidationReason | null;
  lastWriteAt: string | null;
  lastDiceAt: string | null;
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
    const parsed = JSON.parse(await readText(paths.planningState)) as Record<string, unknown>;
    return normalizePlanningState(parsed);
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
  const scaffoldReset = packMode === "scaffolded";
  const state: PlanningStateFile = {
    version: 2,
    planId: paths.planId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    packMode,
    humanConfirmedForWriteAt: scaffoldReset ? null : existing?.humanConfirmedForWriteAt ?? null,
    draftState: scaffoldReset ? "scaffolded" : existing?.draftState ?? "written",
    approvalStatus: scaffoldReset ? "pending" : existing?.approvalStatus ?? "pending",
    approvalInvalidatedBy: scaffoldReset ? null : existing?.approvalInvalidatedBy ?? null,
    lastWriteAt: scaffoldReset ? null : existing?.lastWriteAt ?? null,
    lastDiceAt: scaffoldReset ? null : existing?.lastDiceAt ?? null
  };

  await writeText(paths.planningState, JSON.stringify(state, null, 2));
  return state;
}

export async function markPlanningPackAuthored(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<PlanningStateFile> {
  return recordPlanningPackWrite(workspaceRoot, "write", options);
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
    version: 2,
    planId: paths.planId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    packMode: existing?.packMode ?? "scaffolded",
    humanConfirmedForWriteAt: confirmed ? now : null,
    draftState: existing?.draftState ?? (existing?.packMode === "authored" ? "written" : "scaffolded"),
    approvalStatus: confirmed ? "approved" : "pending",
    approvalInvalidatedBy: null,
    lastWriteAt: existing?.lastWriteAt ?? null,
    lastDiceAt: existing?.lastDiceAt ?? null
  };

  await writeText(paths.planningState, JSON.stringify(state, null, 2));
  return state;
}

export function hasHumanWriteConfirmation(state: PlanningStateFile | null): boolean {
  return state?.approvalStatus === "approved";
}

export async function recordPlanningPackWrite(
  workspaceRoot: string,
  reason: PlanningApprovalInvalidationReason,
  options: PlanningPathOptions = {}
): Promise<PlanningStateFile> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const existing = await loadPlanningState(workspaceRoot, options);
  const now = new Date().toISOString();
  const hadApprovedBaseline = existing?.approvalStatus === "approved";
  const nextDraftState: PlanningDraftState = reason === "dice" ? "sliced" : "written";
  const state: PlanningStateFile = {
    version: 2,
    planId: paths.planId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    packMode: "authored",
    humanConfirmedForWriteAt: existing?.humanConfirmedForWriteAt ?? null,
    draftState: nextDraftState,
    approvalStatus: hadApprovedBaseline ? "stale" : existing?.approvalStatus ?? "pending",
    approvalInvalidatedBy: hadApprovedBaseline || existing?.approvalStatus === "stale" ? reason : null,
    lastWriteAt: reason === "write" ? now : existing?.lastWriteAt ?? null,
    lastDiceAt: reason === "dice" ? now : existing?.lastDiceAt ?? null
  };

  await writeText(paths.planningState, JSON.stringify(state, null, 2));
  return state;
}

export function inferLegacyPackMode(position: {
  lastCompleted: string | null;
  nextRecommended: string | null;
}): PlanningPackMode {
  return position.lastCompleted === "BOOT-001" && position.nextRecommended === "DISCOVER-001" ? "scaffolded" : "authored";
}

function normalizePlanningState(parsed: Record<string, unknown>): PlanningStateFile | null {
  if (
    typeof parsed.planId !== "string" ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    (parsed.packMode !== "scaffolded" && parsed.packMode !== "authored") ||
    !isNullableString(parsed.humanConfirmedForWriteAt)
  ) {
    return null;
  }

  if (parsed.version === 1) {
    const inferredDraftState: PlanningDraftState = parsed.packMode === "authored" ? "written" : "scaffolded";
    const inferredApprovalStatus: PlanningApprovalStatus = parsed.humanConfirmedForWriteAt ? "approved" : "pending";

    return {
      version: 2,
      planId: parsed.planId,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      packMode: parsed.packMode,
      humanConfirmedForWriteAt: (parsed.humanConfirmedForWriteAt as string | null | undefined) ?? null,
      draftState: inferredDraftState,
      approvalStatus: inferredApprovalStatus,
      approvalInvalidatedBy: null,
      lastWriteAt: parsed.packMode === "authored" ? parsed.updatedAt : null,
      lastDiceAt: null
    };
  }

  if (
    parsed.version !== 2 ||
    !isDraftState(parsed.draftState) ||
    !isApprovalStatus(parsed.approvalStatus) ||
    !isNullableInvalidationReason(parsed.approvalInvalidatedBy) ||
    !isNullableString(parsed.lastWriteAt) ||
    !isNullableString(parsed.lastDiceAt)
  ) {
    return null;
  }

  return {
    version: 2,
    planId: parsed.planId,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    packMode: parsed.packMode,
    humanConfirmedForWriteAt: (parsed.humanConfirmedForWriteAt as string | null | undefined) ?? null,
    draftState: parsed.draftState,
    approvalStatus: parsed.approvalStatus,
    approvalInvalidatedBy: parsed.approvalInvalidatedBy ?? null,
    lastWriteAt: parsed.lastWriteAt ?? null,
    lastDiceAt: parsed.lastDiceAt ?? null
  };
}

function isNullableString(value: unknown): value is string | null | undefined {
  return typeof value === "string" || value === null || value === undefined;
}

function isDraftState(value: unknown): value is PlanningDraftState {
  return value === "scaffolded" || value === "written" || value === "sliced";
}

function isApprovalStatus(value: unknown): value is PlanningApprovalStatus {
  return value === "pending" || value === "approved" || value === "stale";
}

function isNullableInvalidationReason(value: unknown): value is PlanningApprovalInvalidationReason | null | undefined {
  return value === "write" || value === "dice" || value === null || value === undefined;
}
