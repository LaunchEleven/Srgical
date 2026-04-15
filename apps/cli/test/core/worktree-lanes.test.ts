import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { createTempWorkspace } from "../helpers/workspace";
import {
  archiveWorktreeLane,
  buildUniqueLaneId,
  createWorktreeLane,
  getWorktreeLaneRegistryPath,
  listWorktreeLanes,
  loadWorktreeLaneRegistry,
  removeWorktreeLane,
  resolveWorktreeLaneRepoState,
  setWorktreeLaneDeleteLock
} from "../../src/core/worktree-lanes";

const execFileAsync = promisify(execFile);

test("buildUniqueLaneId keeps the plan name stable and adds short suffixes on collision", () => {
  assert.equal(buildUniqueLaneId("Release Readiness", new Set()), "release-readiness");
  assert.equal(buildUniqueLaneId("Release Readiness", new Set(["release-readiness"])), "release-readiness-2");
});

test("createWorktreeLane registers lanes and keeps current checkout non-removable", async () => {
  const repo = await initGitRepo("srgical-worktree-lanes-");
  const created = await createWorktreeLane(repo, {
    planId: "release-readiness",
    mode: "prepare",
    now: () => "2026-04-15T00:00:00.000Z"
  });

  assert.equal(created.lane.planId, "release-readiness");
  assert.equal(created.lane.canRemove, false);
  assert.equal(created.lane.deleteLocked, true);
  assert.match(created.lane.branchName ?? "", /^srgical\/release-readiness/);

  const repoState = await resolveWorktreeLaneRepoState(repo);
  assert.ok(repoState.lanes.some((lane) => lane.isCurrentCheckout && lane.canRemove === false));
  assert.ok(repoState.lanes.some((lane) => lane.laneId === created.lane.laneId));

  const registry = await loadWorktreeLaneRegistry(repo);
  assert.equal(registry.lanes.length, 1);
  assert.equal(registry.lanes[0]?.laneId, created.lane.laneId);
  assert.equal(await fileExists(getWorktreeLaneRegistryPath(repo)), true);
});

test("archiveWorktreeLane marks a lane archived and removeWorktreeLane requires explicit unlock before deleting", async () => {
  const repo = await initGitRepo("srgical-worktree-lanes-archive-");
  const created = await createWorktreeLane(repo, {
    planId: "api-hardening",
    mode: "prepare"
  });

  await archiveWorktreeLane(repo, created.lane.laneId, () => "2026-04-15T01:00:00.000Z");
  let lanes = await listWorktreeLanes(await resolveWorktreeLaneRepoState(repo));
  assert.equal(lanes.find((lane) => lane.laneId === created.lane.laneId)?.archived, true);

  await writeFile(path.join(created.workspace, "dirty.txt"), "oops\n", "utf8");
  await assert.rejects(
    () => removeWorktreeLane(repo, created.lane.laneId),
    /is locked/
  );
  await assert.rejects(
    () => removeWorktreeLane(repo, "current"),
    /current checkout/
  );

  await setWorktreeLaneDeleteLock(repo, created.lane.laneId, false, () => "2026-04-15T01:30:00.000Z");
  lanes = await listWorktreeLanes(await resolveWorktreeLaneRepoState(repo));
  const unlocked = lanes.find((lane) => lane.laneId === created.lane.laneId);
  assert.equal(unlocked?.deleteLocked, false);
  assert.equal(unlocked?.canRemove, true);
  assert.equal(unlocked?.unlockedAt, "2026-04-15T01:30:00.000Z");

  await removeWorktreeLane(repo, created.lane.laneId, {
    now: () => "2026-04-15T02:00:00.000Z"
  });

  lanes = await listWorktreeLanes(await resolveWorktreeLaneRepoState(repo));
  assert.ok(!lanes.some((lane) => lane.laneId === created.lane.laneId));
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises");
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
