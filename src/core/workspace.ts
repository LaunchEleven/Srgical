import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const PLAN_DIR = ".srgical";

export type PlanningPackPaths = {
  root: string;
  dir: string;
  plan: string;
  context: string;
  tracker: string;
  nextPrompt: string;
  studioSession: string;
  executionState: string;
  executionLog: string;
};

export function resolveWorkspace(input?: string): string {
  return path.resolve(input ?? process.cwd());
}

export function getPlanningPackPaths(root: string): PlanningPackPaths {
  const dir = path.join(root, PLAN_DIR);

  return {
    root,
    dir,
    plan: path.join(dir, "01-product-plan.md"),
    context: path.join(dir, "02-agent-context-kickoff.md"),
    tracker: path.join(dir, "03-detailed-implementation-plan.md"),
    nextPrompt: path.join(dir, "04-next-agent-prompt.md"),
    studioSession: path.join(dir, "studio-session.json"),
    executionState: path.join(dir, "execution-state.json"),
    executionLog: path.join(dir, "execution-log.md")
  };
}

export async function ensurePlanningDir(root: string): Promise<PlanningPackPaths> {
  const paths = getPlanningPackPaths(root);
  await mkdir(paths.dir, { recursive: true });
  return paths;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function planningPackExists(root: string): Promise<boolean> {
  const paths = getPlanningPackPaths(root);
  const checks = await Promise.all([
    fileExists(paths.plan),
    fileExists(paths.context),
    fileExists(paths.tracker),
    fileExists(paths.nextPrompt)
  ]);

  return checks.every(Boolean);
}

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, "utf8");
}

export async function isGitRepo(root: string): Promise<boolean> {
  return fileExists(path.join(root, ".git"));
}
