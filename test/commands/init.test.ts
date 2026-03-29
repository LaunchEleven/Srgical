import test from "node:test";
import assert from "node:assert/strict";
import { runInitCommand } from "../../src/commands/init";
import { loadPlanningState } from "../../src/core/planning-state";
import { captureStdout } from "../helpers/capture";
import { createTempWorkspace } from "../helpers/workspace";
import { getPlanningPackPaths, readActivePlanId } from "../../src/core/workspace";

test("init --plan creates a named planning pack and activates it", async () => {
  const workspace = await createTempWorkspace("srgical-init-named-");

  const output = await captureStdout(async () => {
    await runInitCommand(workspace, false, "release-readiness");
  });

  const paths = getPlanningPackPaths(workspace, { planId: "release-readiness" });
  const planningState = await loadPlanningState(workspace, { planId: "release-readiness" });

  assert.match(output, /Created planning pack for plan `release-readiness`/);
  assert.equal(await readActivePlanId(workspace), "release-readiness");
  assert.equal(planningState?.packMode, "scaffolded");
  assert.match(paths.relativeDir, /\.srgical\/plans\/release-readiness/);
});

test("init without --plan fails because an explicit named plan is required", async () => {
  const workspace = await createTempWorkspace("srgical-init-missing-plan-");

  await assert.rejects(
    () => runInitCommand(workspace),
    /requires an explicit named plan/i
  );
});
