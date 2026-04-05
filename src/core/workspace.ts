import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const PLAN_DIR = ".srgical";
export const DEFAULT_PLAN_ID = "default";
export const NAMED_PLANS_DIR = "plans";
export const ACTIVE_PLAN_FILE = "active-plan.txt";

export type PlanningDirectoryRef = {
  planId: string;
  dir: string;
  relativeDir: string;
};

export type PlanningPackPaths = {
  root: string;
  planningRoot: string;
  planId: string;
  dir: string;
  relativeDir: string;
  plan: string;
  context: string;
  tracker: string;
  changes: string;
  manifest: string;
  studioSession: string;
  studioOperateConfig: string;
  executionState: string;
  executionLog: string;
  planningState: string;
  autoRunState: string;
  adviceState: string;
  activePlanFile: string;
};

export type PlanningPathOptions = {
  planId?: string | null;
};

export function resolveWorkspace(input?: string): string {
  return path.resolve(input ?? process.cwd());
}

export function normalizePlanId(value?: string | null): string {
  const normalized = (value ?? DEFAULT_PLAN_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : DEFAULT_PLAN_ID;
}

export function getPlanningRoot(root: string): string {
  return path.join(root, PLAN_DIR);
}

export function getPlanningPackPaths(root: string, options: PlanningPathOptions = {}): PlanningPackPaths {
  const planningRoot = getPlanningRoot(root);
  const planId = normalizePlanId(options.planId);
  const dir = path.join(planningRoot, NAMED_PLANS_DIR, planId);
  const relativeDir = path.relative(root, dir).replace(/\\/g, "/") || PLAN_DIR;

  return {
    root,
    planningRoot,
    planId,
    dir,
    relativeDir,
    plan: path.join(dir, "plan.md"),
    context: path.join(dir, "context.md"),
    tracker: path.join(dir, "tracker.md"),
    changes: path.join(dir, "changes.md"),
    manifest: path.join(dir, "manifest.json"),
    studioSession: path.join(dir, "studio-session.json"),
    studioOperateConfig: path.join(dir, "studio-operate-config.json"),
    executionState: path.join(dir, "execution-state.json"),
    executionLog: path.join(dir, "execution-log.md"),
    planningState: path.join(dir, "planning-state.json"),
    autoRunState: path.join(dir, "auto-run-state.json"),
    adviceState: path.join(dir, "advice-state.json"),
    activePlanFile: path.join(planningRoot, ACTIVE_PLAN_FILE)
  };
}

export async function ensurePlanningDir(root: string, options: PlanningPathOptions = {}): Promise<PlanningPackPaths> {
  const paths = getPlanningPackPaths(root, options);
  await mkdir(paths.planningRoot, { recursive: true });
  await mkdir(paths.dir, { recursive: true });
  return paths;
}

export async function ensurePlanningRoot(root: string): Promise<string> {
  const planningRoot = getPlanningRoot(root);
  await mkdir(planningRoot, { recursive: true });
  return planningRoot;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function planningPackExists(root: string, options: PlanningPathOptions = {}): Promise<boolean> {
  const paths = getPlanningPackPaths(root, options);
  const checks = await Promise.all([
    fileExists(paths.plan),
    fileExists(paths.context),
    fileExists(paths.tracker),
    fileExists(paths.changes),
    fileExists(paths.manifest)
  ]);

  return checks.every(Boolean);
}

export async function legacyPlanningPackExists(root: string, options: PlanningPathOptions = {}): Promise<boolean> {
  const paths = getPlanningPackPaths(root, options);
  const checks = await Promise.all([
    fileExists(path.join(paths.dir, "01-product-plan.md")),
    fileExists(path.join(paths.dir, "02-agent-context-kickoff.md")),
    fileExists(path.join(paths.dir, "03-detailed-implementation-plan.md"))
  ]);

  return checks.some(Boolean);
}

export async function listPlanningDirectories(root: string): Promise<PlanningDirectoryRef[]> {
  const namedPlansRoot = path.join(getPlanningRoot(root), NAMED_PLANS_DIR);
  const planIds = new Set<string>();

  try {
    const entries = await readdir(namedPlansRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      planIds.add(normalizePlanId(entry.name));
    }
  } catch {
    // ignore missing named-plan directory
  }

  const activePlanId = await readActivePlanId(root);
  if (activePlanId) {
    planIds.add(activePlanId);
  }

  return Array.from(planIds)
    .sort((left, right) => left.localeCompare(right))
    .map((planId) => {
      const paths = getPlanningPackPaths(root, { planId });
      return {
        planId,
        dir: paths.dir,
        relativeDir: paths.relativeDir
      };
    });
}

export async function readActivePlanId(root: string): Promise<string | null> {
  const markerPath = getPlanningPackPaths(root).activePlanFile;

  if (!(await fileExists(markerPath))) {
    return null;
  }

  try {
    return normalizePlanId(await readText(markerPath));
  } catch {
    return null;
  }
}

export async function saveActivePlanId(root: string, planId: string): Promise<void> {
  const normalizedPlanId = normalizePlanId(planId);
  const planningRoot = await ensurePlanningRoot(root);
  await writeText(path.join(planningRoot, ACTIVE_PLAN_FILE), normalizedPlanId);
}

export async function resolvePlanId(root: string, requestedPlanId?: string | null): Promise<string> {
  if (requestedPlanId && requestedPlanId.trim().length > 0) {
    return normalizePlanId(requestedPlanId);
  }

  const activePlanId = await readActivePlanId(root);

  if (activePlanId) {
    return activePlanId;
  }

  throw new Error(
    "A named plan is required. Pass `<id>` or `--plan <id>`, or create one with `srgical prepare <id>` before continuing."
  );
}

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, "utf8");
}

export async function clearPlanningPackRuntimeState(root: string, options: PlanningPathOptions = {}): Promise<void> {
  const paths = getPlanningPackPaths(root, options);

  await Promise.all([
    rm(paths.studioSession, { force: true }),
    rm(paths.adviceState, { force: true }),
    rm(paths.executionState, { force: true }),
    rm(paths.executionLog, { force: true }),
    rm(paths.autoRunState, { force: true })
  ]);
}

export async function isGitRepo(root: string): Promise<boolean> {
  let current = path.resolve(root);

  while (true) {
    if (await fileExists(path.join(current, ".git"))) {
      return true;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return false;
    }

    current = parent;
  }
}

export function buildLegacyWorkflowError(replacementCommand: string): Error {
  return new Error(
    [
      "This reboot removed the legacy srgical workflow.",
      `Use \`${replacementCommand}\` instead.`,
      "Legacy plan packs using `01-product-plan.md` / `HandoffDoc.md` are intentionally unsupported in this release."
    ].join("\n")
  );
}
