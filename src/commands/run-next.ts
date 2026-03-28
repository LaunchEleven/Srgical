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
import { readPlanningPackState } from "../core/planning-pack-state";
import { readActivePlanId, resolvePlanId, saveActivePlanId } from "../core/workspace";
import { getPlanningPackPaths, readText, resolveWorkspace } from "../core/workspace";

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
    const stopHandler = () => {
      void requestAutoRunStop(workspace, { planId });
      process.stdout.write("Stop requested. Auto mode will finish the current iteration before stopping.\n");
    };

    process.once("SIGINT", stopHandler);

    try {
      const result = await executeAutoRun(workspace, {
        source: "run-next",
        planId,
        agentId: options.agent,
        maxSteps: options.maxSteps,
        onMessage: (line) => {
          process.stdout.write(`${line}\n`);
        }
      });
      process.stdout.write(`${result.summary}\n`);
      return;
    } finally {
      process.removeListener("SIGINT", stopHandler);
    }
  }

  const paths = getPlanningPackPaths(workspace, { planId });
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
      agentId: options.agent,
      planId
    });
    await saveExecutionState(workspace, "success", "run-next", result, { planId });
    await appendExecutionLog(workspace, "success", "run-next", result, {
      planId,
      stepLabel: formatStepLabel(packState.nextStepSummary, packState.currentPosition.nextRecommended)
    });
    process.stdout.write(`${result}\n`);
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
