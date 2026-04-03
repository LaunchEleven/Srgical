import process from "node:process";
import { resolvePrimaryAgent, type AgentStatus } from "../core/agent";
import { readPlanningPackState, type PlanningStepSummary } from "../core/planning-pack-state";
import { isGitRepo, listPlanningDirectories, readActivePlanId, resolvePlanId, resolveWorkspace } from "../core/workspace";
import { paintLine, renderCommandBanner, renderSectionHeading, toneForAvailabilityLine } from "../ui/terminal-theme";

type DoctorCommandOptions = {
  planId?: string | null;
};

export async function runDoctorCommand(workspaceArg?: string, options: DoctorCommandOptions = {}): Promise<void> {
  const workspace = resolveWorkspace(workspaceArg);
  const selectedPlanId = options.planId ? await resolvePlanId(workspace, options.planId) : await readActivePlanId(workspace);
  const [resolvedAgent, gitRepo, planRefs, selectedPlanState] = await Promise.all([
    selectedPlanId ? resolvePrimaryAgent(workspace, { planId: selectedPlanId }) : resolvePrimaryAgent(),
    isGitRepo(workspace),
    listPlanningDirectories(workspace),
    selectedPlanId ? readPlanningPackState(workspace, { planId: selectedPlanId }) : Promise.resolve(null)
  ]);

  const { status: activeAgent, statuses } = resolvedAgent;
  const nextMove = !selectedPlanState
    ? planRefs.length === 0
      ? "Next move: run `srgical init <id>` for a scaffold or `srgical studio <id>` to start planning."
      : "Next move: pass `--plan <id>` to inspect a named pack, or open `srgical studio <id>` to activate one."
    : selectedPlanState.packPresent
    ? selectedPlanState.mode === "Ready to Write" || selectedPlanState.mode === "Gathering Context"
      ? selectedPlanState.packMode === "scaffolded" && selectedPlanState.readiness.readyForFirstDraft
        ? "Next move: run `srgical studio <id>` (or `srgical studio plan --plan <id>` / `srgical ssp <id>`) and use `/write` when you want to lock the first grounded draft."
        : "Next move: run `srgical studio <id>` (or `srgical studio plan --plan <id>` / `srgical ssp <id>`) to refine the plan and inspect `/readiness`."
      : selectedPlanState.mode === "Ready to Execute" || selectedPlanState.mode === "Execution Active" || selectedPlanState.mode === "Auto Running"
        ? "Next move: run `srgical studio operate --plan <id>` (or `srgical sso --plan <id>`) for guided automation, or `srgical run-next --plan <id>` for direct execution."
        : "Next move: run `srgical studio <id>` (or `srgical studio plan --plan <id>` / `srgical ssp <id>`) to queue or refine the next execution-ready step."
    : "Next move: run `srgical init <id>` for a scaffold or `srgical studio <id>` to start planning.";

  const lines = [
    ...renderCommandBanner("srgical", selectedPlanId ? `doctor ${selectedPlanId}` : "doctor"),
    "",
    renderSectionHeading("Workspace"),
    `Workspace: ${workspace}`,
    `Git repo: ${gitRepo ? "yes" : "no"}`,
    `Active plan: ${selectedPlanId ?? "none"}`,
    `Active agent: ${activeAgent.label} (${activeAgent.id}) - ${formatAgentAvailability(activeAgent)}`,
    "",
    renderSectionHeading("Agents"),
    ...renderSupportedAgentLines(statuses, activeAgent.id),
    "",
    renderSectionHeading("Plans"),
    "Plans:"
  ];

  if (planRefs.length === 0) {
    lines.push("- none: no planning packs detected yet");
  } else {
    const planStates = await Promise.all(planRefs.map((ref) => readPlanningPackState(workspace, { planId: ref.planId })));

    for (const state of planStates) {
      lines.push(renderPlanSummaryLine(state, state.planId === selectedPlanId));
    }
  }

  lines.push("", renderSectionHeading("Selected Plan"), ...renderSelectedPlanLines(selectedPlanId, selectedPlanState, planRefs.length));
  lines.push("", renderSectionHeading("Next"), nextMove);

  process.stdout.write(`${lines.map((line) => styleDoctorLine(line)).join("\n")}\n`);
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
    `docs ${state.docsPresent}/5`,
    `human write gate ${state.humanWriteConfirmed ? "confirmed" : "pending"}`,
    `readiness ${state.readiness.score}/${state.readiness.total}`,
    `execution ${state.executionActivated ? "started" : "not-started"}`,
    `auto ${state.autoRun?.status ?? "idle"}`
  ].join(" | ");
}

function styleDoctorLine(line: string): string {
  if (!line || line.includes("\u001b[")) {
    return line;
  }

  if (line.startsWith("- ") || line.startsWith("Active agent:")) {
    return paintLine(line, toneForAvailabilityLine(line));
  }

  if (line.startsWith("Next move:")) {
    return paintLine(line, "brand", { bold: true });
  }

  if (line.startsWith("AI advice: none cached")) {
    return paintLine(line, "muted");
  }

  if (line.startsWith("Next Step: unavailable")) {
    return paintLine(line, "warning");
  }

  return line;
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
    `Docs present: ${state.docsPresent}/5`,
    `Human write confirmation: ${
      state.humanWriteConfirmed ? `confirmed (${state.humanWriteConfirmedAt ?? "timestamp unavailable"})` : "pending"
    }`,
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

  if (state.advice) {
    lines.push(
      `AI advice: ${state.advice.problemStatement}`,
      `  Clarity: ${state.advice.clarity}`,
      `  Assessment: ${state.advice.stateAssessment}`,
      `  Research: ${state.advice.researchNeeded.length > 0 ? state.advice.researchNeeded.join(", ") : "none"}`,
      `  Next: ${state.advice.nextAction}`
    );
  } else {
    lines.push("AI advice: none cached yet (run `/advice` in studio to generate guidance).");
  }

  return lines;
}

function renderSelectedPlanLines(
  selectedPlanId: string | null,
  selectedPlanState: Awaited<ReturnType<typeof readPlanningPackState>> | null,
  planCount: number
): string[] {
  if (!selectedPlanId || !selectedPlanState) {
    return [
      "Selected plan details: none selected yet.",
      planCount > 0
        ? "Use `--plan <id>` to inspect a named pack, or open `srgical studio <id>` to activate one."
        : "Use `srgical init <id>` or `srgical studio <id>` to create the first named planning pack."
    ];
  }

  return [`Selected plan details (${selectedPlanId}):`, ...renderPlanDetailLines(selectedPlanState)];
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
