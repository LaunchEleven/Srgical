import { appendFile } from "node:fs/promises";
import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";
import { parseTrackerRows, type PlanningStepSummary } from "./planning-pack-state";

export type PackSnapshot = {
  plan: string | null;
  context: string | null;
  tracker: string | null;
  changes: string | null;
  manifest: string | null;
  steps: PlanningStepSummary[];
  nextStepId: string | null;
};

export type ChangeSummary = {
  docsChanged: string[];
  contextAdded: string[];
  stepsAdded: string[];
  stepsEdited: string[];
  stepsCompleted: string[];
  stepsBlocked: string[];
  nextStepChange: string | null;
  validationResults: string[];
  headline: string;
};

export async function readPackSnapshot(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<PackSnapshot> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const [plan, context, tracker, changes, manifest] = await Promise.all([
    readOptional(paths.plan),
    readOptional(paths.context),
    readOptional(paths.tracker),
    readOptional(paths.changes),
    readOptional(paths.manifest)
  ]);
  const steps = tracker ? parseTrackerRows(tracker) : [];

  return {
    plan,
    context,
    tracker,
    changes,
    manifest,
    steps,
    nextStepId: tracker ? readCurrentPositionValue(tracker, "Next step") ?? readCurrentPositionValue(tracker, "Next Recommended") : null
  };
}

export function buildChangeSummary(before: PackSnapshot, after: PackSnapshot, headline: string): ChangeSummary {
  const docsChanged = [
    before.plan !== after.plan ? "plan.md" : null,
    before.context !== after.context ? "context.md" : null,
    before.tracker !== after.tracker ? "tracker.md" : null,
    before.changes !== after.changes ? "changes.md" : null,
    before.manifest !== after.manifest ? "manifest.json" : null
  ].filter((value): value is string => Boolean(value));

  const beforeSteps = new Map(before.steps.map((step) => [step.id, step]));
  const afterSteps = new Map(after.steps.map((step) => [step.id, step]));

  const stepsAdded = after.steps.filter((step) => !beforeSteps.has(step.id)).map((step) => step.id);
  const stepsEdited = after.steps
    .filter((step) => {
      const previous = beforeSteps.get(step.id);
      return previous && JSON.stringify(previous) !== JSON.stringify(step);
    })
    .map((step) => step.id);
  const stepsCompleted = after.steps
    .filter((step) => {
      const previous = beforeSteps.get(step.id);
      return previous && previous.status.toLowerCase() !== "done" && step.status.toLowerCase() === "done";
    })
    .map((step) => step.id);
  const stepsBlocked = after.steps
    .filter((step) => {
      const previous = beforeSteps.get(step.id);
      return previous && previous.status.toLowerCase() !== "blocked" && step.status.toLowerCase() === "blocked";
    })
    .map((step) => step.id);

  const contextAdded = summarizeNewBullets(before.context, after.context);
  const validationResults = summarizeValidation(after.steps);
  const nextStepChange =
    before.nextStepId !== after.nextStepId ? `${before.nextStepId ?? "none"} -> ${after.nextStepId ?? "none"}` : null;

  return {
    docsChanged,
    contextAdded,
    stepsAdded,
    stepsEdited,
    stepsCompleted,
    stepsBlocked,
    nextStepChange,
    validationResults,
    headline
  };
}

export async function appendChangeSummary(
  workspaceRoot: string,
  summary: ChangeSummary,
  options: PlanningPathOptions = {}
): Promise<void> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const exists = await fileExists(paths.changes);

  if (!exists) {
    await writeText(paths.changes, "# Changes\n\n## Latest Summary\n\n- Pending first change.\n\n## History\n");
  }

  const now = new Date().toISOString();
  const block = [
    "",
    `### ${now}`,
    "",
    `- Summary: ${summary.headline}`,
    `- Docs changed: ${formatList(summary.docsChanged)}`,
    `- Context added: ${formatList(summary.contextAdded)}`,
    `- Steps added: ${formatList(summary.stepsAdded)}`,
    `- Steps edited: ${formatList(summary.stepsEdited)}`,
    `- Steps completed: ${formatList(summary.stepsCompleted)}`,
    `- Steps blocked: ${formatList(summary.stepsBlocked)}`,
    `- Next step change: ${summary.nextStepChange ?? "none"}`,
    `- Validation: ${formatList(summary.validationResults)}`
  ].join("\n");

  await appendFile(paths.changes, `${block}\n`, "utf8");
}

export function formatChangeSummaryHeadline(summary: ChangeSummary): string {
  return [
    summary.headline,
    `docs ${summary.docsChanged.length}`,
    `added ${summary.stepsAdded.length}`,
    `edited ${summary.stepsEdited.length}`,
    `done ${summary.stepsCompleted.length}`,
    summary.nextStepChange ? `next ${summary.nextStepChange}` : null
  ]
    .filter(Boolean)
    .join(" | ");
}

async function readOptional(filePath: string): Promise<string | null> {
  if (!(await fileExists(filePath))) {
    return null;
  }

  return readText(filePath);
}

function readCurrentPositionValue(tracker: string, label: string): string | null {
  const match = tracker.match(new RegExp(`- ${escapeRegExp(label)}: (?:\\\`([^\\\`]+)\\\`|([^\\n]+))`, "i"));
  return match?.[1]?.trim() ?? match?.[2]?.trim() ?? null;
}

function summarizeNewBullets(before: string | null, after: string | null): string[] {
  if (!after) {
    return [];
  }

  const beforeLines = new Set((before ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("- ")));
  return after
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !beforeLines.has(line))
    .slice(0, 6)
    .map((line) => line.slice(2));
}

function summarizeValidation(steps: PlanningStepSummary[]): string[] {
  return steps
    .filter((step) => step.validation.trim().length > 0 && step.status.toLowerCase() === "done")
    .slice(-4)
    .map((step) => `${step.id}: ${step.validation}`);
}

function formatList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
