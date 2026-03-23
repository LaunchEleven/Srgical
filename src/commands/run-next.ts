import process from "node:process";
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
import { readPlanningPackState } from "../core/planning-pack-state";
import { getPlanningPackPaths, readText, resolveWorkspace } from "../core/workspace";

type RunNextCommandOptions = {
  dryRun?: boolean;
  agent?: string;
};

export async function runRunNextCommand(workspaceArg?: string, options: RunNextCommandOptions = {}): Promise<void> {
  const workspace = resolveWorkspace(workspaceArg);
  const packState = await readPlanningPackState(workspace);

  if (!packState.packPresent) {
    throw new Error("No .srgical planning pack found. Run `srgical init` or `srgical studio` first.");
  }

  if (!options.dryRun && !hasQueuedNextStep(packState.currentPosition.nextRecommended)) {
    throw new Error(formatNoQueuedNextStepMessage("run-next"));
  }

  await resolveExecutionAgent(workspace, options.agent);

  const paths = getPlanningPackPaths(workspace);
  const prompt = await readText(paths.nextPrompt);

  const previewLines = options.dryRun
    ? renderDryRunPreview(prompt, packState.nextStepSummary, packState.currentPosition.nextRecommended)
    : renderExecutionStepLines(packState.nextStepSummary, packState.currentPosition.nextRecommended);

  for (const line of previewLines) {
    process.stdout.write(`${line}\n`);
  }

  if (options.dryRun) {
    return;
  }

  process.stdout.write("\n");
  process.stdout.write(`Running the current next-agent prompt through ${getPrimaryAgentAdapter().label}...\n`);
  try {
    const result = await runNextPrompt(workspace, prompt, {
      agentId: options.agent
    });
    await saveExecutionState(workspace, "success", "run-next", result);
    await appendExecutionLog(workspace, "success", "run-next", result, {
      stepLabel: formatStepLabel(packState.nextStepSummary, packState.currentPosition.nextRecommended)
    });
    process.stdout.write(`${result}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveExecutionState(workspace, "failure", "run-next", message);
    await appendExecutionLog(workspace, "failure", "run-next", message, {
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
