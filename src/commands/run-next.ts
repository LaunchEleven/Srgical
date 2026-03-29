import process from "node:process";
import { executeAutoRun, requestAutoRunStop } from "../core/auto-run";
import { getPrimaryAgentAdapter, resolveExecutionAgent, runNextPrompt } from "../core/agent";
import { appendExecutionLog, saveExecutionState } from "../core/execution-state";
import {
  formatNoQueuedNextStepMessage,
  formatExecutionFailureMessage,
  formatStepLabel,
  hasQueuedNextStep,
  renderDryRunPreview,
  renderExecutionStepLines
} from "../core/execution-controls";
import { buildExecutionIterationPrompt } from "../core/handoff";
import { readPlanningPackState } from "../core/planning-pack-state";
import { resolvePlanId, saveActivePlanId } from "../core/workspace";
import { resolveWorkspace } from "../core/workspace";
import { paintLine, renderCommandBanner, renderSectionHeading } from "../ui/terminal-theme";

type RunNextCommandOptions = {
  dryRun?: boolean;
  agent?: string;
  planId?: string | null;
  auto?: boolean;
  maxSteps?: number;
};

export async function runRunNextCommand(workspaceArg?: string, options: RunNextCommandOptions = {}): Promise<void> {
  const workspace = resolveWorkspace(workspaceArg);
  const planId = await resolvePlanId(workspace, options.planId);
  const packState = await readPlanningPackState(workspace, { planId });

  if (!packState.packPresent) {
    throw new Error("No .srgical planning pack found. Run `srgical init` or `srgical studio` first.");
  }

  if (options.auto && options.dryRun) {
    throw new Error("`--auto` cannot be combined with `--dry-run`.");
  }

  if (!options.dryRun && !hasQueuedNextStep(packState.currentPosition.nextRecommended)) {
    throw new Error(formatNoQueuedNextStepMessage("run-next"));
  }

  await resolveExecutionAgent(workspace, options.agent, { planId });
  await saveActivePlanId(workspace, planId);

  if (options.auto) {
    for (const line of renderCommandBanner("srgical", `run-next auto ${planId}`)) {
      process.stdout.write(`${line}\n`);
    }

    const stopHandler = () => {
      void requestAutoRunStop(workspace, { planId });
      process.stdout.write(`${paintLine("Stop requested. Auto mode will finish the current iteration before stopping.", "warning")}\n`);
    };

    process.once("SIGINT", stopHandler);

    try {
      const result = await executeAutoRun(workspace, {
        source: "run-next",
        planId,
        agentId: options.agent,
        maxSteps: options.maxSteps,
        onMessage: (line) => {
          process.stdout.write(`${styleRunNextLine(line)}\n`);
        }
      });
      process.stdout.write(`${styleRunNextLine(result.summary)}\n`);
      return;
    } finally {
      process.removeListener("SIGINT", stopHandler);
    }
  }

  const handoffPrompt = await buildExecutionIterationPrompt(workspace, packState, { planId });
  const prompt = handoffPrompt.prompt;

  const previewLines = options.dryRun
    ? renderDryRunPreview(prompt, packState.nextStepSummary, packState.currentPosition.nextRecommended)
    : renderExecutionStepLines(packState.nextStepSummary, packState.currentPosition.nextRecommended);

  for (const line of renderCommandBanner("srgical", options.dryRun ? `run-next dry run ${planId}` : `run-next ${planId}`)) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(`${renderSectionHeading("Execution")}\n`);

  for (const line of previewLines) {
    process.stdout.write(`${styleRunNextLine(line)}\n`);
  }

  if (options.dryRun) {
    return;
  }

  process.stdout.write("\n");
  process.stdout.write(`${paintLine(`Running the current execution handoff through ${getPrimaryAgentAdapter().label}...`, "brand", { bold: true })}\n`);
  process.stdout.write(`${paintLine(`Execution handoff source: ${handoffPrompt.handoffDoc.displayPath}`, "muted")}\n`);
  try {
    const result = await runNextPrompt(workspace, prompt, {
      agentId: options.agent,
      planId
    });
    await saveExecutionState(workspace, "success", "run-next", result, { planId });
    await appendExecutionLog(workspace, "success", "run-next", result, {
      planId,
      stepLabel: formatStepLabel(packState.nextStepSummary, packState.currentPosition.nextRecommended)
    });
    process.stdout.write(`${paintLine(result, "success")}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveExecutionState(workspace, "failure", "run-next", message, { planId });
    await appendExecutionLog(workspace, "failure", "run-next", message, {
      planId,
      stepLabel: formatStepLabel(packState.nextStepSummary, packState.currentPosition.nextRecommended)
    });
    throw new Error(
      formatExecutionFailureMessage(
        message,
        packState.nextStepSummary,
        packState.currentPosition.nextRecommended,
        "run-next"
      )
    );
  }
}

function styleRunNextLine(line: string): string {
  if (!line) {
    return line;
  }

  if (line.startsWith("Auto mode failed") || line.startsWith("Execution failed")) {
    return paintLine(line, "danger", { bold: true });
  }

  if (line.startsWith("Auto mode completed") || line.startsWith("Auto mode started")) {
    return paintLine(line, "brand", { bold: true });
  }

  if (line.startsWith("Dry run only")) {
    return paintLine(line, "warning");
  }

  if (line.startsWith("Execution dry run") || line.startsWith("Prompt preview")) {
    return paintLine(line, "section", { bold: true });
  }

  if (line.startsWith("Next step:") || line.startsWith("Scope:") || line.startsWith("Acceptance:") || line.startsWith("Notes:")) {
    return paintLine(line, "info");
  }

  if (line.includes("completed") || line.includes("succeeded")) {
    return paintLine(line, "success");
  }

  return line;
}
