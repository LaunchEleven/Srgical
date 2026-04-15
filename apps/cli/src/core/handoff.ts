import { formatStepLabel } from "./execution-controls";
import type { PlanningPackState } from "./planning-pack-state";
import { buildStudioOperateGuidancePromptSection } from "./studio-operate-config";
import { getPlanningPackPaths, readText, type PlanningPathOptions } from "./workspace";

export type ExecutionHandoffSource = "pack-derived";

export type ExecutionHandoffDoc = {
  source: ExecutionHandoffSource;
  absolutePath: string;
  displayPath: string;
  content: string;
};

export async function buildExecutionIterationPrompt(
  workspaceRoot: string,
  beforeState: PlanningPackState,
  options: PlanningPathOptions = {}
): Promise<{
  prompt: string;
  handoffDoc: ExecutionHandoffDoc;
}> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const guidanceSection = await buildStudioOperateGuidancePromptSection(workspaceRoot, options);
  const targetStepId = beforeState.currentPosition.nextRecommended;
  const stepLabel = formatStepLabel(beforeState.nextStepSummary, targetStepId) ?? "`none queued`";
  const [plan, context, tracker, changes, manifest] = await Promise.all([
    readText(paths.plan),
    readText(paths.context),
    readText(paths.tracker),
    readText(paths.changes),
    readText(paths.manifest)
  ]);

  const content = [
    `Pack source: ${paths.relativeDir}`,
    "",
    "Read these in order:",
    `1. ${paths.relativeDir}/manifest.json`,
    `2. ${paths.relativeDir}/plan.md`,
    `3. ${paths.relativeDir}/context.md`,
    `4. ${paths.relativeDir}/tracker.md`,
    `5. ${paths.relativeDir}/changes.md`
  ].join("\n");

  const prompt = [
    "You are running one deterministic srgical operate iteration in the current repository.",
    "",
    "Operate context:",
    `- Plan directory: \`${paths.relativeDir}\``,
    `- Pack summary source: \`${paths.relativeDir}/manifest.json\` + tracker`,
    `- Changes log: \`${paths.relativeDir}/changes.md\``,
    `- Next step at iteration start: ${stepLabel}`,
    `- Target step id at iteration start: \`${targetStepId ?? "none"}\``,
    "",
    "Iteration contract (must follow):",
    "1. Read the manifest and tracker first.",
    "2. Execute exactly one step block unless the operate mode explicitly asked for auto continuation.",
    "3. Respect confirmed decisions in the plan and evidence in the context doc.",
    "4. Run validation appropriate to the edits you made.",
    "5. Update tracker status, notes, validation, and current position before stopping.",
    "6. Append a visible change summary to changes.md before stopping.",
    "7. Stop after this one block. Do not broaden scope.",
    "",
    "If blocked:",
    "- Mark the active step `blocked` with concrete blocker details.",
    "- Update the change summary and stop.",
    "",
    "Return format:",
    "- `Iteration outcome: <completed|blocked|needs_followup>`",
    "- `Steps touched: <STEP_ID[, STEP_ID]>`",
    "- `Validation: <command(s) and result>`",
    "- `Tracker update: <Last completed -> Next step>`",
    "- then a concise summary paragraph",
    "",
    `manifest.json:`,
    manifest,
    "",
    `plan.md:`,
    plan,
    "",
    `context.md:`,
    context,
    "",
    `tracker.md:`,
    tracker,
    "",
    `changes.md:`,
    changes,
    guidanceSection ? `\n${guidanceSection}` : ""
  ].join("\n");

  return {
    prompt,
    handoffDoc: {
      source: "pack-derived",
      absolutePath: paths.manifest,
      displayPath: `${paths.relativeDir}/manifest.json + tracker.md`,
      content
    }
  };
}
