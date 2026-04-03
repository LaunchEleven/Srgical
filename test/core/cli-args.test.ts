import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveWorkspacePlanArgs } from "../../src/core/cli-args";

test("resolve-workspace-plan-args keeps explicit --plan semantics", () => {
  assert.deepEqual(resolveWorkspacePlanArgs("demo-workspace", "prototype"), {
    workspace: "demo-workspace",
    planId: "prototype"
  });
});

test("resolve-workspace-plan-args treats a non-directory positional arg as a plan id", () => {
  assert.deepEqual(resolveWorkspacePlanArgs("prototype"), {
    workspace: undefined,
    planId: "prototype"
  });
});

test("resolve-workspace-plan-args keeps an existing directory as workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-cli-args-"));

  assert.deepEqual(resolveWorkspacePlanArgs(workspace), {
    workspace,
    planId: undefined
  });
});
