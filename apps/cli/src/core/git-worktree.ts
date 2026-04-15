import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitWorktreeEntry = {
  worktreePath: string;
  head: string | null;
  branchRef: string | null;
  branchName: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
};

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export type GitRepoContext = {
  currentWorkspace: string;
  repoRoot: string;
  commonDir: string;
};

export async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true
  });
  return stdout.trim();
}

export async function resolveGitRepoContext(workspaceRoot: string, runner: GitRunner = runGit): Promise<GitRepoContext> {
  const currentWorkspace = await runner(["rev-parse", "--show-toplevel"], workspaceRoot);
  const commonDirRaw = await runner(["rev-parse", "--path-format=absolute", "--git-common-dir"], currentWorkspace);
  const worktrees = await listGitWorktrees(currentWorkspace, runner);
  const repoRoot = worktrees[0]?.worktreePath ?? currentWorkspace;

  return {
    currentWorkspace,
    repoRoot,
    commonDir: path.isAbsolute(commonDirRaw) ? commonDirRaw : path.resolve(currentWorkspace, commonDirRaw)
  };
}

export async function listGitWorktrees(workspaceRoot: string, runner: GitRunner = runGit): Promise<GitWorktreeEntry[]> {
  const output = await runner(["worktree", "list", "--porcelain"], workspaceRoot);
  return parseGitWorktreeList(output);
}

export async function getCurrentGitBranch(workspaceRoot: string, runner: GitRunner = runGit): Promise<string | null> {
  const branch = await runner(["rev-parse", "--abbrev-ref", "HEAD"], workspaceRoot);
  if (!branch || branch === "HEAD") {
    return null;
  }
  return branch;
}

export async function gitBranchExists(repoRoot: string, branchName: string, runner: GitRunner = runGit): Promise<boolean> {
  try {
    await runner(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], repoRoot);
    return true;
  } catch {
    return false;
  }
}

export async function getGitDirtyState(workspaceRoot: string, runner: GitRunner = runGit): Promise<boolean> {
  const output = await runner(["status", "--porcelain", "--untracked-files=all"], workspaceRoot);
  return output.trim().length > 0;
}

export async function createGitWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string,
  options: {
    baseRef?: string;
    runner?: GitRunner;
  } = {}
): Promise<void> {
  const runner = options.runner ?? runGit;
  const baseRef = options.baseRef ?? "HEAD";
  const branchExists = await gitBranchExists(repoRoot, branchName, runner);
  const args = branchExists
    ? ["worktree", "add", worktreePath, branchName]
    : ["worktree", "add", "-b", branchName, worktreePath, baseRef];
  await runner(args, repoRoot);
}

export async function removeGitWorktree(
  repoRoot: string,
  worktreePath: string,
  options: {
    force?: boolean;
    runner?: GitRunner;
  } = {}
): Promise<void> {
  const args = ["worktree", "remove", worktreePath];
  if (options.force) {
    args.push("--force");
  }
  await (options.runner ?? runGit)(args, repoRoot);
}

export function parseGitWorktreeList(output: string): GitWorktreeEntry[] {
  const normalized = output.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const blocks = normalized.split(/\n\s*\n/g);
  return blocks
    .map((block) => parseWorktreeBlock(block))
    .filter((entry): entry is GitWorktreeEntry => entry !== null);
}

function parseWorktreeBlock(block: string): GitWorktreeEntry | null {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  const worktreeLine = lines.find((line) => line.startsWith("worktree "));
  if (!worktreeLine) {
    return null;
  }

  const branchRef = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length) ?? null;

  return {
    worktreePath: worktreeLine.slice("worktree ".length),
    head: lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length) ?? null,
    branchRef,
    branchName: branchRef?.startsWith("refs/heads/") ? branchRef.slice("refs/heads/".length) : branchRef,
    detached: lines.includes("detached"),
    bare: lines.includes("bare"),
    locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
    prunable: lines.some((line) => line === "prunable" || line.startsWith("prunable "))
  };
}
