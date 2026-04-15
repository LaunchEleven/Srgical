import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { readPlanningPackState } from "./planning-pack-state";
import { savePlanningState } from "./planning-state";
import { getInitialTemplates } from "./templates";
import {
  clearPlanningPackRuntimeState,
  ensurePlanningDir,
  fileExists,
  readText,
  type PlanningPackPaths,
  type PlanningPathOptions,
  writeText
} from "./workspace";

export type PlanningEpochPreparation = {
  archived: boolean;
  archiveDir: string | null;
  archivedFiles: string[];
};

const ARCHIVED_PACK_FILE_NAMES = [
  "plan.md",
  "context.md",
  "tracker.md",
  "changes.md",
  "manifest.json",
  "studio-session.json",
  "planning-state.json",
  "auto-run-state.json",
  "advice-state.json",
  "execution-state.json",
  "execution-log.md"
];

export async function preparePlanningPackForWrite(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<PlanningEpochPreparation> {
  const packState = await readPlanningPackState(workspaceRoot, options);

  if (!packState.packPresent || packState.currentPosition.nextRecommended) {
    return {
      archived: false,
      archiveDir: null,
      archivedFiles: []
    };
  }

  const paths = await ensurePlanningDir(workspaceRoot, options);
  const archiveDirName = await nextPlanningEpochName(paths.dir);
  const archiveDir = path.join(paths.dir, archiveDirName);
  await mkdir(archiveDir, { recursive: false });

  const archivedFiles = await archiveActivePlanningFiles(paths, archiveDir);
  await resetActivePlanningPack(paths);

  return {
    archived: archivedFiles.length > 0,
    archiveDir: archivedFiles.length > 0 ? toRelativePackPath(workspaceRoot, archiveDir) : null,
    archivedFiles
  };
}

export function formatPlanningEpochSummary(preparation: PlanningEpochPreparation): string | null {
  if (!preparation.archived || !preparation.archiveDir) {
    return null;
  }

  return [
    `Started a new revision by snapshotting the previous active pack to ${preparation.archiveDir}.`,
    preparation.archivedFiles.length > 0
      ? `Archived files: ${preparation.archivedFiles.join(", ")}`
      : "Archived files: none"
  ].join("\n");
}

async function archiveActivePlanningFiles(paths: PlanningPackPaths, archiveDir: string): Promise<string[]> {
  const archivedFiles: string[] = [];

  for (const sourcePath of listArchivablePaths(paths)) {
    if (!(await fileExists(sourcePath))) {
      continue;
    }

    const content = await readText(sourcePath);
    const fileName = path.basename(sourcePath);
    await writeText(path.join(archiveDir, fileName), content);
    archivedFiles.push(fileName);
  }

  return archivedFiles;
}

async function resetActivePlanningPack(paths: PlanningPackPaths): Promise<void> {
  const templates = getInitialTemplates(paths);

  await Promise.all(
    Object.entries(templates).map(([filePath, content]) => writeText(filePath, content))
  );

  await clearPlanningPackRuntimeState(paths.root, { planId: paths.planId });
  await savePlanningState(paths.root, "scaffolded", { planId: paths.planId });
}

function listArchivablePaths(paths: PlanningPackPaths): string[] {
  return [
    paths.plan,
    paths.context,
    paths.tracker,
    paths.changes,
    paths.manifest,
    paths.studioSession,
    paths.planningState,
    paths.autoRunState,
    paths.adviceState,
    paths.executionState,
    paths.executionLog
  ];
}

async function nextPlanningEpochName(planningDir: string): Promise<string> {
  let highest = 0;

  try {
    const entries = await readdir(planningDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const match = /^revision-(\d+)$/.exec(entry.name);
      if (!match) {
        continue;
      }

      highest = Math.max(highest, Number(match[1]));
    }
  } catch {
    return "revision-1";
  }

  return `revision-${highest + 1}`;
}

function toRelativePackPath(workspaceRoot: string, value: string): string {
  return path.relative(workspaceRoot, value).replace(/\\/g, "/");
}

export function isArchivedPlanningDirName(value: string): boolean {
  return /^revision-\d+$/.test(value);
}

export function listArchivedPackFileNames(): string[] {
  return [...ARCHIVED_PACK_FILE_NAMES];
}
