import test from "node:test";
import assert from "node:assert/strict";
import { buildBlockedStepResolutionDirective, buildPlanInterrogationDirective } from "../../src/core/plan-interrogation";
import { writeText } from "../../src/core/workspace";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("build-plan-interrogation-directive includes strict assess language and the new pack files", async () => {
  const workspace = await createTempWorkspace("srgical-plan-interrogate-assess-");
  const paths = await writePlanningPack(workspace, { planId: "prototype" });

  await writeText(paths.plan, "# Plan\n\nShip a scoped prototype.");

  const prompt = await buildPlanInterrogationDirective(workspace, "assess", "API integration boundaries", { planId: "prototype" });

  assert.match(prompt, /Command: \/assess API integration boundaries/);
  assert.match(prompt, /can-execute-with-100%-accuracy-now: yes\/no/);
  assert.match(prompt, /Focus: API integration boundaries/);
  assert.match(prompt, /Planning framework wrapper:/);
  assert.match(prompt, /plan\.md:/);
  assert.match(prompt, /context\.md:/);
  assert.match(prompt, /tracker\.md:/);
  assert.match(prompt, /changes\.md:/);
  assert.match(prompt, /manifest\.json:/);
});

test("build-plan-interrogation-directive includes gather-specific output contract", async () => {
  const workspace = await createTempWorkspace("srgical-plan-interrogate-gather-");
  await writePlanningPack(workspace, { planId: "prototype" });

  const prompt = await buildPlanInterrogationDirective(workspace, "gather", "", { planId: "prototype" });

  assert.match(prompt, /Command: \/gather/);
  assert.match(prompt, /Gather objective:/);
  assert.match(prompt, /targeted repo\/doc areas to inspect next/);
  assert.match(prompt, /Focus: entire active plan\./);
});

test("build-blocked-step-resolution-directive appends unblock-specific sections", async () => {
  const workspace = await createTempWorkspace("srgical-plan-interrogate-unblock-");
  await writePlanningPack(workspace, { planId: "prototype" });

  const prompt = await buildBlockedStepResolutionDirective(
    workspace,
    "EXEC-001",
    "waiting on secret provisioning",
    "deployment",
    { planId: "prototype" }
  );

  assert.match(prompt, /Blocked-step resolution overlay:/);
  assert.match(prompt, /blocked-step-id: EXEC-001/);
  assert.match(prompt, /blocked-step-notes: waiting on secret provisioning/);
  assert.match(prompt, /Immediate next command to run in operate mode/);
});
