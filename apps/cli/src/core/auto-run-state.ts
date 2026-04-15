import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

export type AutoRunStatus = "idle" | "running" | "stop_requested" | "stopped" | "completed" | "failed";
export type AutoRunSource = "studio" | "run-next";

export type AutoRunState = {
  version: 1;
  planId: string;
  status: AutoRunStatus;
  startedAt: string | null;
  updatedAt: string;
  endedAt: string | null;
  source: AutoRunSource | null;
  maxSteps: number | null;
  stepsAttempted: number;
  lastStartedStepId: string | null;
  lastObservedNextStepId: string | null;
  stopReason: string | null;
};

export async function loadAutoRunState(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<AutoRunState | null> {
  const paths = getPlanningPackPaths(workspaceRoot, options);

  if (!(await fileExists(paths.autoRunState))) {
    return null;
  }

  try {
    const parsed = JSON.parse(await readText(paths.autoRunState)) as Partial<AutoRunState>;

    if (
      parsed.version !== 1 ||
      typeof parsed.planId !== "string" ||
      !isAutoRunStatus(parsed.status) ||
      (parsed.startedAt !== null && typeof parsed.startedAt !== "string") ||
      typeof parsed.updatedAt !== "string" ||
      (parsed.endedAt !== null && typeof parsed.endedAt !== "string") ||
      (parsed.source !== null && parsed.source !== "studio" && parsed.source !== "run-next") ||
      (parsed.maxSteps !== null && typeof parsed.maxSteps !== "number") ||
      typeof parsed.stepsAttempted !== "number" ||
      (parsed.lastStartedStepId !== null && typeof parsed.lastStartedStepId !== "string") ||
      (parsed.lastObservedNextStepId !== null && typeof parsed.lastObservedNextStepId !== "string") ||
      (parsed.stopReason !== null && typeof parsed.stopReason !== "string")
    ) {
      return null;
    }

    return {
      version: 1,
      planId: parsed.planId,
      status: parsed.status,
      startedAt: parsed.startedAt,
      updatedAt: parsed.updatedAt,
      endedAt: parsed.endedAt,
      source: parsed.source,
      maxSteps: parsed.maxSteps,
      stepsAttempted: parsed.stepsAttempted,
      lastStartedStepId: parsed.lastStartedStepId,
      lastObservedNextStepId: parsed.lastObservedNextStepId,
      stopReason: parsed.stopReason
    };
  } catch {
    return null;
  }
}

export async function saveAutoRunState(
  workspaceRoot: string,
  state: AutoRunState,
  options: PlanningPathOptions = {}
): Promise<AutoRunState> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  await writeText(paths.autoRunState, JSON.stringify(state, null, 2));
  return state;
}

export async function updateAutoRunState(
  workspaceRoot: string,
  updates: Partial<AutoRunState>,
  options: PlanningPathOptions = {}
): Promise<AutoRunState> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const existing = (await loadAutoRunState(workspaceRoot, options)) ?? createIdleAutoRunState(paths.planId);
  const nextState: AutoRunState = {
    ...existing,
    ...updates,
    version: 1,
    planId: paths.planId,
    updatedAt: new Date().toISOString()
  };

  await saveAutoRunState(workspaceRoot, nextState, options);
  return nextState;
}

export function createIdleAutoRunState(planId: string): AutoRunState {
  return {
    version: 1,
    planId,
    status: "idle",
    startedAt: null,
    updatedAt: new Date().toISOString(),
    endedAt: null,
    source: null,
    maxSteps: null,
    stepsAttempted: 0,
    lastStartedStepId: null,
    lastObservedNextStepId: null,
    stopReason: null
  };
}

function isAutoRunStatus(value: unknown): value is AutoRunStatus {
  return (
    value === "idle" ||
    value === "running" ||
    value === "stop_requested" ||
    value === "stopped" ||
    value === "completed" ||
    value === "failed"
  );
}
