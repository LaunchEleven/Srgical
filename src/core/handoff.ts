import path from "node:path";
import { formatStepLabel } from "./execution-controls";
import type { PlanningPackState } from "./planning-pack-state";
import { fileExists, getPlanningPackPaths, readText, type PlanningPathOptions } from "./workspace";

export type ExecutionHandoffSource = "plan-handoff" | "workspace-handoff" | "legacy-next-prompt";

export type ExecutionHandoffDoc = {
  source: ExecutionHandoffSource;
  absolutePath: string;
  displayPath: string;
  content: string;
};

export async function resolveExecutionHandoffDoc(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<ExecutionHandoffDoc> {
  for (const candidate of listHandoffDocCandidates(workspaceRoot, options)) {
    if (!(await fileExists(candidate.absolutePath))) {
      continue;
    }

    return {
      ...candidate,
      content: await readText(candidate.absolutePath)
    };
  }

  const paths = getPlanningPackPaths(workspaceRoot, options);
  throw new Error(
    `Execution handoff prompt missing. Expected \`${paths.relativeDir}/HandoffDoc.md\` or \`${paths.relativeDir}/04-next-agent-prompt.md\`.`
  );
}

export async function buildExecutionIterationPrompt(
  workspaceRoot: string,
  beforeState: PlanningPackState,
  options: PlanningPathOptions = {}
): Promise<{
  prompt: string;
  handoffDoc: ExecutionHandoffDoc;
}> {
  const handoffDoc = await resolveExecutionHandoffDoc(workspaceRoot, options);
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const targetStepId = beforeState.currentPosition.nextRecommended;
  const stepLabel = formatStepLabel(beforeState.nextStepSummary, targetStepId) ?? "`none queued`";
  const prompt = [
    "You are running one deterministic srgical execution iteration in the current repository.",
    "",
    "Execution context:",
    `- Plan directory: \`${paths.relativeDir}\``,
    `- Canonical handoff doc: \`${handoffDoc.displayPath}\` (${describeHandoffSource(handoffDoc.source)})`,
    `- Tracker: \`${paths.relativeDir}/03-detailed-implementation-plan.md\``,
    `- Kickoff log: \`${paths.relativeDir}/02-agent-context-kickoff.md\``,
    `- Next step at iteration start: ${stepLabel}`,
    `- Target step id at iteration start: \`${targetStepId ?? "none queued"}\``,
    "",
    "Iteration contract (must follow):",
    "1. Read the canonical handoff doc first and follow it strictly.",
    "2. Re-check the tracker current position before editing.",
    "3. Execute exactly one eligible step block (usually one step, at most two contiguous low-risk steps).",
    "4. Run validation appropriate to the edits you made.",
    "5. Update tracker current position and step status/notes before stopping.",
    "6. Append a dated handoff entry in the kickoff log before stopping.",
    "7. Stop after this one block. Do not start a second execution block in this run.",
    "",
    "If blocked:",
    "- Mark the active step `blocked` in the tracker with concrete blocker details.",
    "- Record the blocker in the kickoff handoff log and stop.",
    "",
    "Return format:",
    "- `Iteration outcome: <completed|blocked|needs_followup>`",
    "- `Steps touched: <STEP_ID[, STEP_ID]>`",
    "- `Validation: <command(s) and result>`",
    "- `Tracker update: <Last Completed -> Next Recommended>`",
    "- then a concise summary paragraph",
    "",
    `Canonical handoff instructions from \`${handoffDoc.displayPath}\`:`,
    "",
    handoffDoc.content
  ].join("\n");

  return {
    prompt,
    handoffDoc
  };
}

function listHandoffDocCandidates(
  workspaceRoot: string,
  options: PlanningPathOptions
): Array<Pick<ExecutionHandoffDoc, "source" | "absolutePath" | "displayPath">> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const planHandoffPath = paths.handoff;
  const workspaceHandoffPath = path.join(workspaceRoot, "HandoffDoc.md");
  const candidates: Array<Pick<ExecutionHandoffDoc, "source" | "absolutePath" | "displayPath">> = [
    {
      source: "plan-handoff",
      absolutePath: planHandoffPath,
      displayPath: toDisplayPath(workspaceRoot, planHandoffPath)
    }
  ];

  if (workspaceHandoffPath !== planHandoffPath) {
    candidates.push({
      source: "workspace-handoff",
      absolutePath: workspaceHandoffPath,
      displayPath: toDisplayPath(workspaceRoot, workspaceHandoffPath)
    });
  }

  candidates.push({
    source: "legacy-next-prompt",
    absolutePath: paths.nextPrompt,
    displayPath: toDisplayPath(workspaceRoot, paths.nextPrompt)
  });

  return candidates;
}

function describeHandoffSource(source: ExecutionHandoffSource): string {
  switch (source) {
    case "plan-handoff":
      return "plan-local handoff";
    case "workspace-handoff":
      return "workspace handoff";
    case "legacy-next-prompt":
      return "legacy next-agent prompt fallback";
  }
}

function toDisplayPath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
}
