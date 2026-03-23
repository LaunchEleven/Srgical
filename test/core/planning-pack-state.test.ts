import test from "node:test";
import assert from "node:assert/strict";
import { readPlanningPackState } from "../../src/core/planning-pack-state";
import { getPlanningPackPaths, writeText } from "../../src/core/workspace";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("readPlanningPackState parses tracker position and next step summary", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-");
  const paths = await writePlanningPack(workspace);

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`PLAN-001\`
- Next Recommended: \`EXEC-001\`
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`

## Delivery

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC-001 | pending | PLAN-001 | Ship a safe execution slice. | The slice runs and validates cleanly. | Pending smoke verification. |
`
  );

  const state = await readPlanningPackState(workspace);

  assert.equal(state.packPresent, true);
  assert.equal(state.trackerReadable, true);
  assert.equal(state.currentPosition.lastCompleted, "PLAN-001");
  assert.equal(state.currentPosition.nextRecommended, "EXEC-001");
  assert.equal(state.nextStepSummary?.id, "EXEC-001");
  assert.equal(state.nextStepSummary?.phase, "Delivery");
  assert.equal(state.nextStepSummary?.scope, "Ship a safe execution slice.");
});

test("readPlanningPackState treats an explicit 'none queued' tracker position as no queued step", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-none-");
  const paths = await writePlanningPack(workspace);

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`DIST001\`
- Next Recommended: none queued
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`
`
  );

  const state = await readPlanningPackState(workspace);

  assert.equal(state.packPresent, true);
  assert.equal(state.currentPosition.lastCompleted, "DIST001");
  assert.equal(state.currentPosition.nextRecommended, null);
  assert.equal(state.nextStepSummary, null);
});
