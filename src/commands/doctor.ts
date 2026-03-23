import process from "node:process";
import { resolvePrimaryAgent, type AgentStatus } from "../core/agent";
import { readPlanningPackState, type PlanningStepSummary } from "../core/planning-pack-state";
import { isGitRepo, resolveWorkspace } from "../core/workspace";

export async function runDoctorCommand(workspaceArg?: string): Promise<void> {
  const workspace = resolveWorkspace(workspaceArg);
  const [resolvedAgent, packState, gitRepo] = await Promise.all([
    resolvePrimaryAgent(workspace),
    readPlanningPackState(workspace),
    isGitRepo(workspace)
  ]);

  const { status: activeAgent, statuses } = resolvedAgent;
  const lines = [
    `Workspace: ${workspace}`,
    `Git repo: ${gitRepo ? "yes" : "no"}`,
    `Planning pack: ${packState.packPresent ? "present" : "missing"}`,
    `Active agent: ${activeAgent.label} (${activeAgent.id}) - ${formatAgentAvailability(activeAgent)}`,
    "",
    ...renderSupportedAgentLines(statuses, activeAgent.id),
  ];

  if (packState.packPresent) {
    lines.push("", ...renderNextStepLines(packState.nextStepSummary, packState.currentPosition.nextRecommended));
  }

  lines.push(
    "",
    packState.packPresent
      ? packState.nextStepSummary || packState.currentPosition.nextRecommended
        ? "Next move: run `srgical studio` to refine the plan or `srgical run-next` to execute the next step."
        : "Next move: run `srgical studio` to queue more work or update the tracker with a new recommended step."
      : "Next move: run `srgical init` for a local scaffold or `srgical studio` to plan with the primary agent first."
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

function formatAgentAvailability(status: AgentStatus): string {
  return status.available
    ? `available (${status.version ?? "version unknown"})`
    : `missing (${status.error ?? "unknown error"})`;
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
