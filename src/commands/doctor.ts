import process from "node:process";
import { resolvePrimaryAgent, type AgentStatus } from "../core/agent";
import { readPlanningPackState, type PlanningStepSummary } from "../core/planning-pack-state";
import {
  DEFAULT_PLAN_ID,
  isGitRepo,
  listPlanningDirectories,
  resolvePlanId,
  resolveWorkspace
} from "../core/workspace";

type DoctorCommandOptions = {
  planId?: string | null;
};

export async function runDoctorCommand(workspaceArg?: string, options: DoctorCommandOptions = {}): Promise<void> {
  const workspace = resolveWorkspace(workspaceArg);
  const selectedPlanId = await resolvePlanId(workspace, options.planId);
  const [resolvedAgent, gitRepo, planRefs, selectedPlanState] = await Promise.all([
    resolvePrimaryAgent(workspace, { planId: selectedPlanId }),
    isGitRepo(workspace),
    listPlanningDirectories(workspace),
    readPlanningPackState(workspace, { planId: selectedPlanId })
  ]);

  const { status: activeAgent, statuses } = resolvedAgent;
  const lines = [
    `Workspace: ${workspace}`,
    `Git repo: ${gitRepo ? "yes" : "no"}`,
    `Active plan: ${selectedPlanId}`,
    `Active agent: ${activeAgent.label} (${activeAgent.id}) - ${formatAgentAvailability(activeAgent)}`,
    "",
    ...renderSupportedAgentLines(statuses, activeAgent.id),
    "",
    "Plans:"
  ];

  if (planRefs.length === 0) {
    lines.push(`- ${DEFAULT_PLAN_ID}: no planning packs detected yet`);
  } else {
    const planStates = await Promise.all(planRefs.map((ref) => readPlanningPackState(workspace, { planId: ref.planId })));

    for (const state of planStates) {
      lines.push(renderPlanSummaryLine(state, state.planId === selectedPlanId));
    }
  }

  lines.push("", `Selected plan details (${selectedPlanId}):`, ...renderPlanDetailLines(selectedPlanState));

  lines.push(
    "",
    selectedPlanState.packPresent
      ? selectedPlanState.mode === "Ready to Write" || selectedPlanState.mode === "Gathering Context"
        ? "Next move: run `srgical studio` to refine the plan, check `/readiness`, and use `/write` when it is ready."
        : selectedPlanState.mode === "Ready to Execute" || selectedPlanState.mode === "Execution Active" || selectedPlanState.mode === "Auto Running"
          ? "Next move: run `srgical run-next --plan <id>` for one step or `srgical run-next --plan <id> --auto` to continue automatically."
          : "Next move: run `srgical studio` to queue or refine the next execution-ready step."
      : "Next move: run `srgical init --plan <id>` for a scaffold or `srgical studio --plan <id>` to start planning."
  );

  process.stdout.write(`${lines.join("\n")}\n`);
}

function renderSupportedAgentLines(statuses: AgentStatus[], activeAgentId: string): string[] {
  const lines = ["Supported agents:"];

  for (const status of statuses) {
    lines.push(
      `- ${status.label} (${status.id})${status.id === activeAgentId ? " [active]" : ""}: ${formatAgentAvailability(status)} via ${status.command}`
    );
  }

  return lines;
}

function renderPlanSummaryLine(
  state: Awaited<ReturnType<typeof readPlanningPackState>>,
  selected: boolean
): string {
  return [
    `- ${state.planId}${selected ? " [active]" : ""}:`,
    `path ${state.packDir}`,
    `mode ${state.mode}`,
    `docs ${state.docsPresent}/4`,
    `readiness ${state.readiness.score}/${state.readiness.total}`,
    `execution ${state.executionActivated ? "started" : "not-started"}`,
    `auto ${state.autoRun?.status ?? "idle"}`
  ].join(" | ");
}

function formatAgentAvailability(status: AgentStatus): string {
  return status.available
    ? `available (${status.version ?? "version unknown"})`
    : `missing (${status.error ?? "unknown error"})`;
}

function renderPlanDetailLines(state: Awaited<ReturnType<typeof readPlanningPackState>>): string[] {
  const lines = [
    `Plan dir: ${state.packDir}`,
    `Pack present: ${state.packPresent ? "yes" : "no"}`,
    `Pack mode: ${state.packMode}`,
    `Mode: ${state.mode}${state.hasFailureOverlay ? " [last run failed]" : ""}`,
    `Docs present: ${state.docsPresent}/4`,
    `Readiness: ${state.readiness.score}/${state.readiness.total}${state.readiness.readyToWrite ? " (ready to write)" : ""}`,
    `Execution activated: ${state.executionActivated ? "yes" : "no"}`,
    `Auto mode: ${state.autoRun?.status ?? "idle"}`
  ];

  if (state.readiness.missingLabels.length > 0) {
    lines.push(`Missing readiness signals: ${state.readiness.missingLabels.join(", ")}`);
  }

  lines.push(...renderNextStepLines(state.nextStepSummary, state.currentPosition.nextRecommended));

  if (state.lastExecution) {
    lines.push(`Last run: ${state.lastExecution.status} via ${state.lastExecution.source} at ${state.lastExecution.updatedAt}`);
  }

  if (state.autoRun) {
    lines.push(
      `Auto run detail: attempted ${state.autoRun.stepsAttempted}${state.autoRun.maxSteps ? `/${state.autoRun.maxSteps}` : ""}, stop reason ${state.autoRun.stopReason ?? "none"}`
    );
  }

  return lines;
}

function renderNextStepLines(
  nextStepSummary: PlanningStepSummary | null,
  nextRecommended: string | null
): string[] {
  if (!nextStepSummary) {
    return [
      "Next Step: unavailable",
      nextRecommended
        ? `Tracker points to \`${nextRecommended}\`, but its table row could not be summarized.`
        : "Tracker does not currently expose a next recommended step."
    ];
  }

  const lines = [
    `Next Step: ${nextStepSummary.id}${nextStepSummary.phase ? ` (${nextStepSummary.phase})` : ""}`,
    `  Scope: ${nextStepSummary.scope || "unknown"}`,
    `  Acceptance: ${nextStepSummary.acceptance || "unknown"}`,
    `  Status: ${nextStepSummary.status || "unknown"}`
  ];

  if (nextStepSummary.notes) {
    lines.push(`  Notes: ${nextStepSummary.notes}`);
  }

  return lines;
}
