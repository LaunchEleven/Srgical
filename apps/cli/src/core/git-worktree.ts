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

export type GitWorktreeDiagnostics = {
  baseRef: string | null;
  mergeBase: string | null;
  aheadCount: number;
  behindCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
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

export async function getGitWorktreeDiagnostics(
  workspaceRoot: string,
  runner: GitRunner = runGit
): Promise<GitWorktreeDiagnostics> {
  const status = await runner(["status", "--porcelain=v1", "--untracked-files=all"], workspaceRoot);
  const counts = parseGitStatusPorcelain(status);
  const baseRef = await resolveGitBaseRef(workspaceRoot, runner);
  let mergeBase: string | null = null;
  let aheadCount = 0;
  let behindCount = 0;
  if (baseRef) {
    mergeBase = await runner(["merge-base", "HEAD", baseRef], workspaceRoot).catch(() => null);
    const divergence = await runner(["rev-list", "--left-right", "--count", `${baseRef}...HEAD`], workspaceRoot).catch(() => "0\t0");
    const [behind, ahead] = divergence.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
    behindCount = Number.isFinite(behind) ? behind : 0;
    aheadCount = Number.isFinite(ahead) ? ahead : 0;
  }
  return { baseRef, mergeBase, aheadCount, behindCount, ...counts };
}

export function parseGitStatusPorcelain(output: string): Omit<GitWorktreeDiagnostics, "baseRef" | "mergeBase" | "aheadCount" | "behindCount"> {
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  let conflictCount = 0;
  const conflictCodes = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
  for (const line of output.replace(/\r\n/g, "\n").split("\n")) {
    if (!line) continue;
    const code = line.slice(0, 2);
    if (code === "??") {
      untrackedCount += 1;
      continue;
    }
    if (conflictCodes.has(code)) conflictCount += 1;
    if (code[0] && code[0] !== " ") stagedCount += 1;
    if (code[1] && code[1] !== " ") unstagedCount += 1;
  }
  return { stagedCount, unstagedCount, untrackedCount, conflictCount };
}

async function resolveGitBaseRef(workspaceRoot: string, runner: GitRunner): Promise<string | null> {
  const remoteHead = await runner(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], workspaceRoot).catch(() => "");
  if (remoteHead) return remoteHead;
  for (const candidate of ["main", "master"]) {
    const exists = await runner(["rev-parse", "--verify", "--quiet", candidate], workspaceRoot).then(() => true).catch(() => false);
    if (exists) return candidate;
  }
  return null;
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
