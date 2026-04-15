import process from "node:process";
import { executeAutoRun } from "../core/auto-run";
import { appendExecutionLog, saveExecutionState } from "../core/execution-state";
import { formatExecutionFailureMessage, formatNoQueuedNextStepMessage, hasQueuedNextStep, renderDryRunPreview } from "../core/execution-controls";
import { buildExecutionIterationPrompt } from "../core/handoff";
import { readPlanningPackState } from "../core/planning-pack-state";
import { assertNoLegacyPack } from "../core/prepare-pack";
import { resolveExecutionAgent, runNextPrompt } from "../core/agent";
import { resolvePlanId, resolveWorkspace, saveActivePlanId } from "../core/workspace";
import { paintLine, renderCommandBanner, renderSectionHeading } from "../ui/terminal-theme";
import { launchStudio } from "../ui/studio";
import { launchWebStudio } from "../ui/web-studio";

type OperateOptions = {
  planId?: string | null;
  dryRun?: boolean;
  auto?: boolean;
  maxSteps?: number;
  checkpoint?: boolean;
  agent?: string | null;
  renderer?: "web" | "terminal" | null;
  openBrowser?: boolean;
};

export async function runOperateCommand(workspaceArg?: string, options: OperateOptions = {}): Promise<void> {
  const workspace = resolveWorkspace(workspaceArg);
  const planId = await resolvePlanId(workspace, options.planId);
  await assertNoLegacyPack(workspace, `srgical operate ${planId}`, { planId });
  await saveActivePlanId(workspace, planId);

  if (!options.dryRun && !options.auto && !options.checkpoint && !options.agent) {
    if (options.renderer !== "terminal") {
      try {
        await launchWebStudio({
          workspace,
          planId,
          mode: "operate",
          openBrowser: options.openBrowser
        });
        return;
      } catch (error) {
        if (options.renderer === "web") {
          throw error;
        }
      }
    }
    await launchStudio({ workspace, planId, mode: "operate" });
    return;
  }

  const state = await readPlanningPackState(workspace, { planId });
  if (!state.packPresent) {
    throw new Error("No prepare pack was found for this plan. Run `srgical prepare <id>` first.");
  }
  if (!options.dryRun && state.approvalStatus !== "approved") {
    throw new Error("Operate requires an approved draft. Open `srgical prepare <id>`, review the plan, and approve it first.");
  }
  if (!options.dryRun && !hasQueuedNextStep(state.currentPosition.nextRecommended)) {
    throw new Error(formatNoQueuedNextStepMessage("run-next"));
  }

  await resolveExecutionAgent(workspace, options.agent, { planId });

  if (options.auto) {
    for (const line of renderCommandBanner("srgical", `operate auto ${planId}`)) {
      process.stdout.write(`${line}\n`);
    }
    const result = await executeAutoRun(workspace, {
      source: "run-next",
      planId,
      agentId: options.agent ?? undefined,
      maxSteps: options.maxSteps
    });
    process.stdout.write(`${paintLine(result.summary, "brand", { bold: true })}\n`);
    return;
  }

  const prompt = await buildExecutionIterationPrompt(workspace, state, { planId });
  for (const line of renderCommandBanner("srgical", options.dryRun ? `operate dry run ${planId}` : `operate ${planId}`)) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(`${renderSectionHeading("Execution")}\n`);
  for (const line of renderDryRunPreview(prompt.prompt, state.nextStepSummary, state.currentPosition.nextRecommended)) {
    process.stdout.write(`${line}\n`);
  }

  if (options.dryRun) {
    return;
  }

  process.stdout.write(`${paintLine(`Running the next step through ${options.agent ?? "the active agent"}...`, "brand", { bold: true })}\n`);
  process.stdout.write(`${paintLine(`Prompt source: ${prompt.handoffDoc.displayPath}`, "muted")}\n`);
  try {
    const result = await runNextPrompt(workspace, prompt.prompt, {
      planId,
      agentId: options.agent ?? undefined
    });
    await saveExecutionState(workspace, "success", "run-next", result, { planId });
    await appendExecutionLog(workspace, "success", "run-next", result, {
      planId,
      stepLabel: state.nextStepSummary?.id ?? state.currentPosition.nextRecommended
    });
    process.stdout.write(`${paintLine(result, "success")}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveExecutionState(workspace, "failure", "run-next", message, { planId });
    await appendExecutionLog(workspace, "failure", "run-next", message, {
      planId,
      stepLabel: state.nextStepSummary?.id ?? state.currentPosition.nextRecommended
    });
    throw new Error(formatExecutionFailureMessage(message, state.nextStepSummary, state.currentPosition.nextRecommended, "run-next"));
  }
}
