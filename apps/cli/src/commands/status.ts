import process from "node:process";
import { resolvePrimaryAgent } from "../core/agent";
import { readPlanningPackState } from "../core/planning-pack-state";
import { assertNoLegacyPack } from "../core/prepare-pack";
import { listPlanningDirectories, readActivePlanId, resolvePlanId, resolveWorkspace } from "../core/workspace";
import { paintLine, renderCommandBanner, renderSectionHeading } from "../ui/terminal-theme";

export async function runStatusCommand(workspaceArg?: string, options: { planId?: string | null } = {}): Promise<void> {
  const workspace = resolveWorkspace(workspaceArg);
  const planId = options.planId ? await resolvePlanId(workspace, options.planId) : await readActivePlanId(workspace);
  const [agent, plans] = await Promise.all([resolvePrimaryAgent(workspace, planId ? { planId } : {}), listPlanningDirectories(workspace)]);

  const lines = [
    ...renderCommandBanner("srgical", planId ? `status ${planId}` : "status"),
    "",
    renderSectionHeading("Workspace"),
    `Workspace: ${workspace}`,
    `Active plan: ${planId ?? "none"}`,
    `Active agent: ${agent.status.label} (${agent.status.id})`,
    "",
    renderSectionHeading("Plans")
  ];

  if (plans.length === 0) {
    lines.push("No plans yet. Start with `srgical prepare <id>`.");
  } else {
    for (const plan of plans) {
      const legacyError = await assertNoLegacyPack(workspace, `srgical prepare ${plan.planId}`, { planId: plan.planId }).catch((error) => error as Error);
      if (legacyError) {
        lines.push(`- ${plan.planId}${plan.planId === planId ? " [active]" : ""}: legacy pack unsupported | next action srgical prepare ${plan.planId}`);
        continue;
      }
      const state = await readPlanningPackState(workspace, { planId: plan.planId });
      lines.push(
        `- ${plan.planId}${plan.planId === planId ? " [active]" : ""}: stage ${state.mode} | next action ${state.nextAction} | next step ${
          state.currentPosition.nextRecommended ?? "none"
        } | last change ${state.manifest?.lastChangeSummary ?? "none"}`
      );
    }
  }

  if (!planId) {
    lines.push("", renderSectionHeading("Next"), paintLine("Next: run `srgical prepare <id>` to create or open a plan.", "brand", { bold: true }));
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  await assertNoLegacyPack(workspace, `srgical status ${planId}`, { planId });
  const state = await readPlanningPackState(workspace, { planId });
  lines.push(
    "",
    renderSectionHeading("Selected Plan"),
    `Stage: ${state.mode}`,
    `Next action: ${state.nextAction}`,
    `Next step: ${state.currentPosition.nextRecommended ?? "none"}`,
    `Last change: ${state.manifest?.lastChangeSummary ?? "none"}`,
    `Evidence: ${state.evidence.join(" | ") || "none"}`,
    `Unknowns: ${state.unknowns.join(" | ") || "none"}`,
    `Execution mode: ${state.manifest?.executionMode ?? "step"}`,
    "",
    renderSectionHeading("Next"),
    paintLine(`Next: ${state.nextAction}`, "brand", { bold: true })
  );

  process.stdout.write(`${lines.join("\n")}\n`);
}
