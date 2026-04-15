import test from "node:test";
import assert from "node:assert/strict";
import { readPlanningPackState } from "../../src/core/planning-pack-state";
import { applyPlanningPackDocumentState } from "../../src/core/planning-doc-state";
import { recordPlanningPackWrite, savePlanningState, setHumanWriteConfirmation } from "../../src/core/planning-state";
import { saveStudioSession } from "../../src/core/studio-session";
import { updatePlanManifest } from "../../src/core/plan-manifest";
import { writeText } from "../../src/core/workspace";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("readPlanningPackState parses tracker position and next step summary", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-");
  const paths = await writePlanningPack(workspace);

  await writeText(
    paths.tracker,
    `# Tracker

## Current Position

- Last completed: \`BOOT-001\`
- Next step: \`SPIKE-001\`
- Updated at: \`2026-03-24T00:00:00.000Z\`
- Updated by: \`srgical\`

## Delivery

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPIKE-001 | spike | todo | BOOT-001 | Ship a safe proof slice. | The proof runs and validates cleanly. | npm test -- test/core/planning-pack-state.test.ts | Pending smoke verification. |
`
  );

  const state = await readPlanningPackState(workspace);

  assert.equal(state.packPresent, true);
  assert.equal(state.trackerReadable, true);
  assert.equal(state.currentPosition.lastCompleted, "BOOT-001");
  assert.equal(state.currentPosition.nextRecommended, "SPIKE-001");
  assert.equal(state.nextStepSummary?.id, "SPIKE-001");
  assert.equal(state.nextStepSummary?.type, "spike");
  assert.equal(state.nextStepSummary?.phase, "Delivery");
  assert.equal(state.nextStepSummary?.validation, "npm test -- test/core/planning-pack-state.test.ts");
  assert.equal(state.remainingExecutionSteps, 1);
});

test("readPlanningPackState treats an explicit 'none queued' tracker position as no queued step", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-none-");
  const paths = await writePlanningPack(workspace);

  await writeText(
    paths.tracker,
    `# Tracker

## Current Position

- Last completed: \`DISCOVER-001\`
- Next step: none queued
- Updated at: \`2026-03-24T00:00:00.000Z\`
- Updated by: \`srgical\`
`
  );

  const state = await readPlanningPackState(workspace);

  assert.equal(state.packPresent, true);
  assert.equal(state.currentPosition.lastCompleted, "DISCOVER-001");
  assert.equal(state.currentPosition.nextRecommended, null);
  assert.equal(state.nextStepSummary, null);
  assert.equal(state.remainingExecutionSteps, 0);
});

test("readPlanningPackState counts remaining execution steps from the queued tracker row onward", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-remaining-steps-");
  const paths = await writePlanningPack(workspace);

  await writeText(
    paths.tracker,
    `# Tracker

## Current Position

- Last completed: \`EXEC-001\`
- Next step: \`EXEC-002\`
- Updated at: \`2026-03-24T00:00:00.000Z\`
- Updated by: \`srgical\`

## Delivery

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXEC-001 | build | done | PLAN-001 | Execute slice one. | Slice one lands. | npm test | Completed. |
| EXEC-002 | build | todo | EXEC-001 | Execute slice two. | Slice two lands. | npm test | Pending. |
| EXEC-003 | validate | blocked | EXEC-002 | Execute slice three. | Slice three lands. | npm test | Waiting on env. |
| EXEC-004 | rollout | skipped | EXEC-003 | Execute slice four. | Slice four lands. | npm test | Deferred. |
| EXEC-005 | build | todo | EXEC-004 | Execute slice five. | Slice five lands. | npm test | Pending. |
`
  );

  const state = await readPlanningPackState(workspace);

  assert.equal(state.currentPosition.nextRecommended, "EXEC-002");
  assert.equal(state.remainingExecutionSteps, 3);
});

test("readPlanningPackState keeps fresh scaffolds in discover mode with minimal readiness", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-default-seed-");
  await writePlanningPack(workspace);

  const state = await readPlanningPackState(workspace);

  assert.equal(state.mode, "Discover");
  assert.equal(state.docsPresent, 1);
  assert.equal(state.readiness.score, 1);
  assert.equal(state.readiness.total, 5);
  assert.equal(state.readiness.readyForFirstDraft, false);
  assert.equal(state.readiness.readyToWrite, false);
  assert.equal(state.readiness.readyToDice, false);
  assert.match(state.readiness.missingLabels.join(", "), /Desired outcome captured/);
});

test("readPlanningPackState recognizes when the transcript is ready for a first draft but not yet for slicing", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-readiness-");
  await writePlanningPack(workspace);

  await saveStudioSession(workspace, [
    {
      role: "user",
      content: "We need to improve the prepare and operate workflow in this repo while keeping the CLI deterministic and easy for a human to follow."
    },
    {
      role: "assistant",
      content:
        "The repo already has a terminal UI and planning documents, so the safest first step is to keep the structure local-first, capture evidence clearly, and avoid hidden state names while we tighten the execution path."
    },
    {
      role: "user",
      content:
        "The plan must keep the next action obvious, preserve completed work, and define a first safe implementation step that agents can execute without guessing."
    }
  ]);

  const state = await readPlanningPackState(workspace);

  assert.equal(state.readiness.score, 4);
  assert.equal(state.readiness.readyForFirstDraft, true);
  assert.equal(state.readiness.readyToWrite, true);
  assert.equal(state.readiness.readyToDice, false);
  assert.match(state.readiness.missingLabels.join(", "), /Explicit go-ahead captured/);
});

test("readPlanningPackState uses manifest stage, evidence, and unknowns as the source of truth", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-manifest-");
  const paths = await writePlanningPack(workspace);

  await applyPlanningPackDocumentState(paths, "grounded");
  await recordPlanningPackWrite(workspace, "dice");
  await setHumanWriteConfirmation(workspace, true);
  await updatePlanManifest(workspace, {
    stage: "ready",
    nextAction: "Open operate and run the next step.",
    nextStepId: "SPIKE-001",
    evidence: ["src/ui/studio.ts", "docs/studio-plan-tutorial.md"],
    unknowns: ["Need one more spike validation result before rollout."],
    contextReady: true,
    approvedAt: "2026-04-05T00:01:00.000Z"
  });

  const state = await readPlanningPackState(workspace);

  assert.equal(state.mode, "Ready");
  assert.equal(state.nextAction, "Open operate and run the next step.");
  assert.deepEqual(state.evidence, ["src/ui/studio.ts", "docs/studio-plan-tutorial.md"]);
  assert.deepEqual(state.unknowns, ["Need one more spike validation result before rollout."]);
});

test("recordPlanningPackWrite marks approved baselines stale after a later draft refresh", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-approved-stale-");
  const paths = await writePlanningPack(workspace);
  await applyPlanningPackDocumentState(paths, "grounded");
  await savePlanningState(workspace, "scaffolded");
  await recordPlanningPackWrite(workspace, "dice");
  await setHumanWriteConfirmation(workspace, true);
  await recordPlanningPackWrite(workspace, "write");

  const state = await readPlanningPackState(workspace);

  assert.equal(state.docsPresent, 5);
  assert.equal(state.draftState, "written");
  assert.equal(state.approvalStatus, "stale");
  assert.equal(state.approvalInvalidatedBy, "write");
  assert.equal(state.readiness.readyToDice, false);
  assert.equal(state.readiness.readyToApprove, true);
});
