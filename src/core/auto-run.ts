import { appendExecutionLog, saveExecutionState } from "./execution-state";
import { formatStepLabel } from "./execution-controls";
import { buildExecutionIterationPrompt } from "./handoff";
import { readPlanningPackState, isExecutionReadyState, type PlanningPackState } from "./planning-pack-state";
import { loadAutoRunState, updateAutoRunState, type AutoRunSource, type AutoRunState } from "./auto-run-state";
import type { PlanningPathOptions } from "./workspace";
import { runNextPrompt } from "./agent";

const DEFAULT_AUTO_MAX_STEPS = 10;

export type AutoRunOptions = {
  source: AutoRunSource;
  planId?: string | null;
  agentId?: string | null;
  maxSteps?: number;
  onMessage?: (line: string) => void | Promise<void>;
};

export type AutoRunResult = {
  finalState: AutoRunState;
  summary: string;
};

export async function executeAutoRun(workspaceRoot: string, options: AutoRunOptions): Promise<AutoRunResult> {
  const planOptions: PlanningPathOptions = { planId: options.planId };
  const initialState = await readPlanningPackState(workspaceRoot, planOptions);
  assertAutoRunnable(initialState);

  const maxSteps = sanitizeMaxSteps(options.maxSteps);
  let autoRunState = await updateAutoRunState(
    workspaceRoot,
    {
      status: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      source: options.source,
      maxSteps,
      stepsAttempted: 0,
      lastStartedStepId: initialState.currentPosition.nextRecommended,
      lastObservedNextStepId: initialState.currentPosition.nextRecommended,
      stopReason: null
    },
    planOptions
  );

  await emit(options, `Auto mode started for plan \`${initialState.planId}\` with max ${maxSteps} step${maxSteps === 1 ? "" : "s"}.`);

  for (let iteration = 0; iteration < maxSteps; iteration += 1) {
    const requestedStopState = await loadAutoRunState(workspaceRoot, planOptions);
    if (requestedStopState?.status === "stop_requested") {
      autoRunState = await finalizeAutoRun(workspaceRoot, "stopped", "Stop requested by user.", options, {
        stepsAttempted: iteration
      });
      return {
        finalState: autoRunState,
        summary: autoRunState.stopReason ?? "Auto run stopped."
      };
    }

    const beforeState = await readPlanningPackState(workspaceRoot, planOptions);
    const naturalStop = describeNaturalStop(beforeState, iteration, maxSteps);

    if (naturalStop) {
      autoRunState = await finalizeAutoRun(workspaceRoot, naturalStop.status, naturalStop.reason, options, {
        stepsAttempted: iteration,
        lastObservedNextStepId: beforeState.currentPosition.nextRecommended
      });
      return {
        finalState: autoRunState,
        summary: naturalStop.reason
      };
    }

    const stepLabel = formatStepLabel(beforeState.nextStepSummary, beforeState.currentPosition.nextRecommended) ?? "unknown step";
    await emit(options, `Auto iteration ${iteration + 1}/${maxSteps}: ${stepLabel}`);
    autoRunState = await updateAutoRunState(
      workspaceRoot,
      {
        status: "running",
        source: options.source,
        maxSteps,
        stepsAttempted: iteration + 1,
        lastStartedStepId: beforeState.currentPosition.nextRecommended,
        lastObservedNextStepId: beforeState.currentPosition.nextRecommended,
        stopReason: null
      },
      planOptions
    );

    const iterationResult = await executeIteration(workspaceRoot, beforeState, options);

    if (!iterationResult.success) {
      autoRunState = await finalizeAutoRun(workspaceRoot, "failed", iterationResult.summary, options, {
        stepsAttempted: iteration + 1,
        lastStartedStepId: beforeState.currentPosition.nextRecommended,
        lastObservedNextStepId: iterationResult.afterState.currentPosition.nextRecommended
      });
      return {
        finalState: autoRunState,
        summary: iterationResult.summary
      };
    }

    await emit(options, iterationResult.summary);
  }

  autoRunState = await finalizeAutoRun(
    workspaceRoot,
    "stopped",
    `Reached the auto-run step cap (${maxSteps}).`,
    options,
    { stepsAttempted: maxSteps }
  );

  return {
    finalState: autoRunState,
    summary: autoRunState.stopReason ?? `Reached the auto-run step cap (${maxSteps}).`
  };
}

export async function requestAutoRunStop(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<AutoRunState> {
  const current = await loadAutoRunState(workspaceRoot, options);
  const status = current?.status === "running" ? "stop_requested" : "stopped";

  return updateAutoRunState(
    workspaceRoot,
    {
      status,
      stopReason: status === "stop_requested" ? "Stop requested by user." : "No active auto run was in progress."
    },
    options
  );
}

function sanitizeMaxSteps(value?: number): number {
  if (!value || !Number.isFinite(value) || value < 1) {
    return DEFAULT_AUTO_MAX_STEPS;
  }

  return Math.floor(value);
}

function assertAutoRunnable(state: PlanningPackState): void {
  if (!state.packPresent) {
    throw new Error("Auto mode requires an existing planning pack.");
  }

  if (state.packMode !== "authored") {
    throw new Error("Auto mode only runs authored plans. Finish planning and `/write` the pack first.");
  }

  if (state.approvalStatus !== "approved") {
    throw new Error("Auto mode requires an approved plan baseline. Review the current draft and run `/confirm-plan` first.");
  }

  if (!isExecutionReadyState(state)) {
    throw new Error("Auto mode requires a queued execution step in the selected plan.");
  }
}

function describeNaturalStop(
  state: PlanningPackState,
  iteration: number,
  maxSteps: number
): { status: "completed" | "stopped" | "failed"; reason: string } | null {
  if (!state.currentPosition.nextRecommended) {
    return {
      status: "completed",
      reason: "Auto mode completed because no next recommended step remains."
    };
  }

  if (!state.nextStepSummary) {
    return {
      status: "failed",
      reason: `Auto mode stopped because the tracker could not summarize \`${state.currentPosition.nextRecommended}\`.`
    };
  }

  if (state.nextStepSummary.status.toLowerCase() === "blocked") {
    return {
      status: "stopped",
      reason: `Auto mode stopped because ${state.nextStepSummary.id} is blocked. Resolve the blocker in the tracker, then continue with \`/go\` (studio operate) or rerun auto mode.`
    };
  }

  if (!isExecutionReadyState(state)) {
    return state.approvalStatus !== "approved"
      ? {
          status: "stopped",
          reason: `Auto mode stopped because ${state.nextStepSummary.id} is no longer on an approved plan baseline. Review the draft and run \`/confirm-plan\` before continuing.`
        }
      : {
          status: "stopped",
          reason: `Auto mode stopped because ${state.nextStepSummary.id} is outside execution scope.`
        };
  }

  if (iteration >= maxSteps) {
    return {
      status: "stopped",
      reason: `Reached the auto-run step cap (${maxSteps}).`
    };
  }

  return null;
}

async function executeIteration(
  workspaceRoot: string,
  beforeState: PlanningPackState,
  options: AutoRunOptions
): Promise<{
  success: boolean;
  summary: string;
  afterState: PlanningPackState;
}> {
  const planOptions: PlanningPathOptions = { planId: options.planId };
  const targetStepId = beforeState.currentPosition.nextRecommended;
  const stepLabel = formatStepLabel(beforeState.nextStepSummary, beforeState.currentPosition.nextRecommended);
  const { prompt, handoffDoc } = await buildExecutionIterationPrompt(workspaceRoot, beforeState, planOptions);

  await emit(options, `Execution handoff source: ${handoffDoc.displayPath}`);

  let firstAttempt: { ok: boolean; message: string };

  try {
    const result = await runNextPrompt(workspaceRoot, prompt, {
      agentId: options.agentId,
      planId: beforeState.planId
    });
    firstAttempt = { ok: true, message: result };
  } catch (error) {
    firstAttempt = { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const firstAfterState = await readPlanningPackState(workspaceRoot, planOptions);
  const firstReconciled = hasTrackerAdvanced(beforeState, firstAfterState, targetStepId);

  if (firstReconciled) {
    const summary = firstAttempt.ok
      ? firstAttempt.message
      : `Reconciled success after an execution error because the tracker advanced for ${targetStepId ?? "the active step"}.`;
    await saveExecutionState(workspaceRoot, "success", options.source, summary, planOptions);
    await appendExecutionLog(workspaceRoot, "success", options.source, summary, {
      planId: beforeState.planId,
      stepLabel
    });
    return {
      success: true,
      summary: `Advanced tracker state for ${stepLabel ?? targetStepId ?? "the current step"}.`,
      afterState: firstAfterState
    };
  }

  await emit(options, `No tracker advancement detected for ${stepLabel ?? targetStepId ?? "the current step"}; retrying once.`);

  try {
    const retryResult = await runNextPrompt(workspaceRoot, prompt, {
      agentId: options.agentId,
      planId: beforeState.planId
    });
    const retryAfterState = await readPlanningPackState(workspaceRoot, planOptions);

    if (hasTrackerAdvanced(beforeState, retryAfterState, targetStepId)) {
      await saveExecutionState(workspaceRoot, "success", options.source, retryResult, planOptions);
      await appendExecutionLog(workspaceRoot, "success", options.source, retryResult, {
        planId: beforeState.planId,
        stepLabel
      });
      return {
        success: true,
        summary: `Advanced tracker state for ${stepLabel ?? targetStepId ?? "the current step"} after one reconciliation retry.`,
        afterState: retryAfterState
      };
    }

    const failureSummary = `Auto mode failed because ${targetStepId ?? "the current step"} did not advance after one retry.`;
    await saveExecutionState(workspaceRoot, "failure", options.source, failureSummary, planOptions);
    await appendExecutionLog(workspaceRoot, "failure", options.source, failureSummary, {
      planId: beforeState.planId,
      stepLabel
    });
    return {
      success: false,
      summary: failureSummary,
      afterState: retryAfterState
    };
  } catch (error) {
    const retryAfterState = await readPlanningPackState(workspaceRoot, planOptions);

    if (hasTrackerAdvanced(beforeState, retryAfterState, targetStepId)) {
      const summary = `Reconciled success after a retry failure because the tracker advanced for ${targetStepId ?? "the active step"}.`;
      await saveExecutionState(workspaceRoot, "success", options.source, summary, planOptions);
      await appendExecutionLog(workspaceRoot, "success", options.source, summary, {
        planId: beforeState.planId,
        stepLabel
      });
      return {
        success: true,
        summary: `Advanced tracker state for ${stepLabel ?? targetStepId ?? "the current step"} after reconciliation.`,
        afterState: retryAfterState
      };
    }

    const failureSummary = `Auto mode failed because ${targetStepId ?? "the current step"} did not advance after one retry. Reason: ${
      error instanceof Error ? error.message : String(error)
    }`;
    await saveExecutionState(workspaceRoot, "failure", options.source, failureSummary, planOptions);
    await appendExecutionLog(workspaceRoot, "failure", options.source, failureSummary, {
      planId: beforeState.planId,
      stepLabel
    });
    return {
      success: false,
      summary: failureSummary,
      afterState: retryAfterState
    };
  }
}

function hasTrackerAdvanced(
  beforeState: PlanningPackState,
  afterState: PlanningPackState,
  targetStepId: string | null
): boolean {
  if (!targetStepId) {
    return false;
  }

  if (afterState.currentPosition.nextRecommended && afterState.currentPosition.nextRecommended !== targetStepId) {
    return true;
  }

  if (afterState.currentPosition.lastCompleted === targetStepId) {
    return true;
  }

  if (
    beforeState.currentPosition.updatedAt &&
    afterState.currentPosition.updatedAt &&
    beforeState.currentPosition.updatedAt !== afterState.currentPosition.updatedAt
  ) {
    return true;
  }

  if (afterState.nextStepSummary && afterState.nextStepSummary.id === targetStepId) {
    const status = afterState.nextStepSummary.status.toLowerCase();
    if (status === "done" || status === "skipped") {
      return true;
    }
  }

  const beforeTargetSummary = beforeState.nextStepSummary?.id === targetStepId ? beforeState.nextStepSummary : null;
  const afterTargetSummary = afterState.nextStepSummary?.id === targetStepId ? afterState.nextStepSummary : null;

  if (beforeTargetSummary && afterTargetSummary) {
    if (normalizeTrackerValue(beforeTargetSummary.status) !== normalizeTrackerValue(afterTargetSummary.status)) {
      return true;
    }

    if (normalizeTrackerValue(beforeTargetSummary.notes) !== normalizeTrackerValue(afterTargetSummary.notes)) {
      return true;
    }
  }

  return false;
}

function normalizeTrackerValue(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function finalizeAutoRun(
  workspaceRoot: string,
  status: "stopped" | "completed" | "failed",
  reason: string,
  options: AutoRunOptions,
  updates: Partial<AutoRunState> = {}
): Promise<AutoRunState> {
  const nextState = await updateAutoRunState(
    workspaceRoot,
    {
      ...updates,
      status,
      endedAt: new Date().toISOString(),
      stopReason: reason
    },
    { planId: options.planId }
  );

  await appendExecutionLog(workspaceRoot, status === "failed" ? "failure" : "success", options.source, reason, {
    planId: nextState.planId,
    stepLabel: "auto-run summary"
  });
  await emit(options, reason);
  return nextState;
}

async function emit(options: AutoRunOptions, line: string): Promise<void> {
  if (options.onMessage) {
    await options.onMessage(line);
  }
}
