import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRecentRepositories, recordRecentRepository } from "../../src/core/repository-history";

test("repository history keeps the most recently selected repositories first without duplicates", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "srgical-repository-history-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const alpha = path.join(home, "alpha");
  const beta = path.join(home, "beta");

  await recordRecentRepository(alpha, home);
  await recordRecentRepository(beta, home);
  await recordRecentRepository(alpha, home);

  const history = await loadRecentRepositories(home);
  assert.deepEqual(history.map((entry) => entry.path), [path.resolve(alpha), path.resolve(beta)]);
  assert.ok(history[0].lastOpenedAt >= history[1].lastOpenedAt);
});
