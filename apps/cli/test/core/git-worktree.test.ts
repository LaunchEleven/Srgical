import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { createTempWorkspace } from "../helpers/workspace";
import {
  createGitWorktree,
  getGitDirtyState,
  listGitWorktrees,
  parseGitWorktreeList,
  removeGitWorktree,
  resolveGitRepoContext
} from "../../src/core/git-worktree";

const execFileAsync = promisify(execFile);

test("parseGitWorktreeList reads porcelain output", () => {
  const entries = parseGitWorktreeList(
    [
      "worktree /repo/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/feature",
      "HEAD def456",
      "branch refs/heads/feature",
      "locked"
    ].join("\n")
  );

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.worktreePath, "/repo/main");
  assert.equal(entries[0]?.branchName, "main");
  assert.equal(entries[1]?.branchName, "feature");
  assert.equal(entries[1]?.locked, true);
});

test("git-worktree helpers create, list, detect dirty state, and remove lanes", async () => {
  const repo = await initGitRepo("srgical-git-worktree-");
  const repoContext = await resolveGitRepoContext(repo);
  const worktreePath = path.join(path.dirname(repoContext.repoRoot), ".srgical-worktrees", path.basename(repoContext.repoRoot), "feature-a");

  await createGitWorktree(repoContext.repoRoot, worktreePath, "srgical/feature-a");

  const worktrees = await listGitWorktrees(repo);
  assert.ok(worktrees.some((entry) => normalizePath(entry.worktreePath) === normalizePath(repoContext.repoRoot) && entry.branchName === "main"));
  assert.ok(worktrees.some((entry) => normalizePath(entry.worktreePath) === normalizePath(worktreePath) && entry.branchName === "srgical/feature-a"));

  assert.equal(await getGitDirtyState(worktreePath), false);
  await writeFile(path.join(worktreePath, "feature.txt"), "lane change\n", "utf8");
  assert.equal(await getGitDirtyState(worktreePath), true);

  await execGit(["add", "feature.txt"], worktreePath);
  await execGit(["commit", "-m", "feature lane"], worktreePath);
  assert.equal(await getGitDirtyState(worktreePath), false);

  await removeGitWorktree(repoContext.repoRoot, worktreePath);
  const afterRemoval = await listGitWorktrees(repo);
  assert.ok(!afterRemoval.some((entry) => normalizePath(entry.worktreePath) === normalizePath(worktreePath)));
});

async function initGitRepo(prefix: string): Promise<string> {
  const repo = await createTempWorkspace(prefix);
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "package.json"), "{\"name\":\"demo\"}\n", "utf8");
  await writeFile(path.join(repo, "src", "index.ts"), "export const demo = true;\n", "utf8");
  await execGit(["init", "-b", "main"], repo);
  await execGit(["config", "user.name", "Srgical Test"], repo);
  await execGit(["config", "user.email", "test@example.com"], repo);
  await execGit(["add", "."], repo);
  await execGit(["commit", "-m", "initial"], repo);
  return repo;
}

async function execGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}
