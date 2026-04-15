import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { isGitRepo } from "../../src/core/workspace";
import { createTempWorkspace } from "../helpers/workspace";

test("is-git-repo detects repositories from nested directories", async () => {
  const workspace = await createTempWorkspace("srgical-workspace-git-");
  const repoRoot = path.join(workspace, "repo");
  const nestedDir = path.join(repoRoot, "packages", "cli");

  await mkdir(path.join(repoRoot, ".git"), { recursive: true });
  await mkdir(nestedDir, { recursive: true });

  assert.equal(await isGitRepo(nestedDir), true);
});

test("is-git-repo returns false outside a repository", async () => {
  const workspace = await createTempWorkspace("srgical-workspace-no-git-");
  const nestedDir = path.join(workspace, "packages", "cli");

  await mkdir(nestedDir, { recursive: true });

  assert.equal(await isGitRepo(nestedDir), false);
});
