import { mkdir, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { appendChangeSummary, buildChangeSummary, formatChangeSummaryHeadline, readPackSnapshot, type PackSnapshot } from "./change-summary";
import { ensurePlanManifest, updatePlanManifest, buildStepCountsFromRows } from "./plan-manifest";
import { readPlanningPackState, parseTrackerRows, type PlanningMode } from "./planning-pack-state";
import { savePlanningState } from "./planning-state";
import { ensureStudioUiConfig } from "./studio-ui-config";
import { getInitialTemplates } from "./templates";
import {
  buildLegacyWorkflowError,
  ensurePlanningDir,
  getPlanningPackPaths,
  legacyPlanningPackExists,
  planningPackExists,
  saveActivePlanId,
  writeText,
  type PlanningPathOptions
} from "./workspace";

export async function ensurePreparePack(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<ReturnType<typeof getPlanningPackPaths>> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const [packPresent, legacyPackPresent] = await Promise.all([
    planningPackExists(workspaceRoot, options),
    legacyPlanningPackExists(workspaceRoot, options)
  ]);

  if (legacyPackPresent && !packPresent) {
    throw buildLegacyWorkflowError(`srgical prepare ${paths.planId}`);
  }

  if (!packPresent) {
    const templates = getInitialTemplates(paths);
    await Promise.all(Object.entries(templates).map(([filePath, content]) => writeText(filePath, content)));
    await savePlanningState(workspaceRoot, "scaffolded", { planId: paths.planId });
    await ensurePlanManifest(workspaceRoot, { planId: paths.planId });
  }

  await ensureStudioUiConfig(workspaceRoot, { planId: paths.planId });

  await saveActivePlanId(workspaceRoot, paths.planId);
  return paths;
}

export async function assertNoLegacyPack(
  workspaceRoot: string,
  replacementCommand: string,
  options: PlanningPathOptions = {}
): Promise<void> {
  const [packPresent, legacyPackPresent] = await Promise.all([
    planningPackExists(workspaceRoot, options),
    legacyPlanningPackExists(workspaceRoot, options)
  ]);

  if (legacyPackPresent && !packPresent) {
    throw buildLegacyWorkflowError(replacementCommand);
  }
}

export async function snapshotRevisionIfNeeded(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<string | null> {
  const state = await readPlanningPackState(workspaceRoot, options);

  if (!state.packPresent || !state.manifest) {
    return null;
  }

  const stage = state.manifest.stage;
  const shouldSnapshot =
    stage === "executing" ||
    stage === "blocked" ||
    stage === "finished" ||
    state.manifest.stepCounts.done > 0;

  if (!shouldSnapshot) {
    return null;
  }

  const paths = getPlanningPackPaths(workspaceRoot, options);
  const revisionsDir = path.join(paths.dir, "revisions");
  await mkdir(revisionsDir, { recursive: true });
  const revisionName = await nextRevisionName(revisionsDir);
  const snapshotDir = path.join(revisionsDir, revisionName);
  await mkdir(snapshotDir, { recursive: false });

  for (const filePath of [paths.plan, paths.context, paths.tracker, paths.changes, paths.manifest]) {
    await copyFile(filePath, path.join(snapshotDir, path.basename(filePath)));
  }

  await updatePlanManifest(
    workspaceRoot,
    {
      revision: state.manifest.revision + 1,
      lastChangeSummary: `Snapshot created before refinement: ${path.relative(workspaceRoot, snapshotDir).replace(/\\/g, "/")}`
    },
    options
  );

  return path.relative(workspaceRoot, snapshotDir).replace(/\\/g, "/");
}

export async function recordVisibleChange(
  workspaceRoot: string,
  before: PackSnapshot,
  headline: string,
  options: PlanningPathOptions & {
    action: "prepare" | "refine" | "operate";
    stage?: PlanningMode;
    nextAction?: string;
    executionMode?: "step" | "auto" | "checkpoint";
    evidence?: string[];
    unknowns?: string[];
  }
): Promise<string> {
  const after = await readPackSnapshot(workspaceRoot, options);
  const summary = buildChangeSummary(before, after, headline);
  summary.docsChanged = Array.from(new Set([...summary.docsChanged, "changes.md", "manifest.json"]));
  const formattedHeadline = formatChangeSummaryHeadline(summary);

  await appendChangeSummary(workspaceRoot, summary, options);

  const state = await readPlanningPackState(workspaceRoot, options);
  const trackerText = after.tracker ?? "";
  const stepCounts = buildStepCountsFromRows(trackerText ? parseTrackerRows(trackerText) : []);
  const now = new Date().toISOString();

  await updatePlanManifest(
    workspaceRoot,
    {
      stage: options.stage ? toManifestStage(options.stage) : state.manifest?.stage ?? "discover",
      nextAction: options.nextAction ?? state.nextAction,
      nextStepId: state.currentPosition.nextRecommended,
      stepCounts,
      executionMode: options.executionMode ?? state.manifest?.executionMode ?? "step",
      lastPreparedAt: options.action === "prepare" ? now : state.manifest?.lastPreparedAt ?? null,
      lastRefinedAt: options.action === "refine" ? now : state.manifest?.lastRefinedAt ?? null,
      lastOperatedAt: options.action === "operate" ? now : state.manifest?.lastOperatedAt ?? null,
      lastChangeSummary: formattedHeadline,
      evidence: options.evidence ?? state.evidence,
      unknowns: options.unknowns ?? state.unknowns
    },
    options
  );

  return formattedHeadline;
}

async function nextRevisionName(revisionsDir: string): Promise<string> {
  let highest = 0;

  for (const entry of await readdir(revisionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const match = /^revision-(\d+)$/.exec(entry.name);
    if (!match) {
      continue;
    }

    highest = Math.max(highest, Number(match[1]));
  }

  return `revision-${highest + 1}`;
}

function toManifestStage(mode: PlanningMode) {
  if (mode === "Discover") {
    return "discover" as const;
  }
  if (mode === "Prepare") {
    return "draft" as const;
  }
  if (mode === "Ready") {
    return "ready" as const;
  }
  if (mode === "Execute" || mode === "Auto Running") {
    return "executing" as const;
  }
  if (mode === "Blocked") {
    return "blocked" as const;
  }
  if (mode === "Finished") {
    return "finished" as const;
  }

  return "out_of_date" as const;
}
