import test from "node:test";
import assert from "node:assert/strict";
import { readPlanningPackState } from "../../src/core/planning-pack-state";
import { applyPlanningPackDocumentState } from "../../src/core/planning-doc-state";
import { recordPlanningPackWrite, savePlanningState, setHumanWriteConfirmation } from "../../src/core/planning-state";
import { saveStudioSession } from "../../src/core/studio-session";
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

test("readPlanningPackState does not award readiness points for the default studio seed alone", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-default-seed-");
  await writePlanningPack(workspace);

  const state = await readPlanningPackState(workspace);

  assert.equal(state.mode, "Gathering Context");
  assert.equal(state.docsPresent, 0);
  assert.equal(state.readiness.score, 0);
  assert.equal(state.readiness.total, 5);
  assert.equal(state.readiness.readyForFirstDraft, false);
  assert.equal(state.readiness.readyToWrite, false);
  assert.match(state.readiness.missingLabels.join(", "), /Goal captured/);
});

test("readPlanningPackState keeps scaffolded packs in gathering-context mode without an explicit go-ahead", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-readiness-");
  await writePlanningPack(workspace);

  await saveStudioSession(workspace, [
    {
      role: "assistant",
      content: "Describe what you are building, what is already true in the repo, or the next decision you need to make."
    },
    {
      role: "user",
      content: "Lets go ahead look at a minor refactor in this repo and keep runtime behavior stable."
    },
    {
      role: "assistant",
      content:
        "This repo has three obvious refactor surfaces: the core library, the test adapter, or the docs app. Which one are we touching first?"
    },
    {
      role: "user",
      content:
        "We're going to go through the source library and find an opportunity to employ better object oriented modelling without breaking the code, and I would like to think in terms of SOLID principles."
    },
    {
      role: "assistant",
      content:
        "The safest first refactor target is the execution settings path, which is a strong candidate for a small value object seam that reduces parameter sprawl without changing runtime behavior."
    },
    {
      role: "user",
      content: "can you"
    }
  ]);

  const state = await readPlanningPackState(workspace);

  assert.equal(state.mode, "Ready to Draft");
  assert.equal(state.readiness.score, 4);
  assert.equal(state.readiness.readyForFirstDraft, true);
  assert.equal(state.readiness.readyToWrite, true);
  assert.equal(state.readiness.readyToDice, false);
  assert.equal(state.readiness.readyToApprove, false);
  assert.match(state.readiness.missingLabels.join(", "), /Explicit go-ahead captured/);
});

test("readPlanningPackState ignores echoed slash commands for readiness", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-command-echo-");
  await writePlanningPack(workspace);

  await saveStudioSession(workspace, [
    {
      role: "system",
      content: "Command: /status"
    }
  ]);

  const state = await readPlanningPackState(workspace);

  assert.equal(state.readiness.score, 0);
  assert.equal(state.readiness.readyForFirstDraft, false);
  assert.equal(state.readiness.readyToWrite, false);
  assert.equal(state.readiness.readyToDice, false);
});

test("readPlanningPackState marks scaffolded packs ready only after a clear go-ahead", async () => {
  const workspace = await createTempWorkspace("srgical-pack-state-ready-");
  await writePlanningPack(workspace);

  await saveStudioSession(workspace, [
    {
      role: "assistant",
      content: "Describe what you are building, what is already true in the repo, or the next decision you need to make."
    },
    {
      role: "user",
      content: "Lets go ahead look at a minor refactor in this repo and keep runtime behavior stable."
    },
    {
      role: "assistant",
      content:
        "This repo has three obvious refactor surfaces: the core library, the test adapter, or the docs app. Which one are we touching first?"
    },
    {
      role: "user",
      content:
        "We're going to go through the source library and find an opportunity to employ better object oriented modelling without breaking the code, and I would like to think in terms of SOLID principles."
    },
    {
      role: "assistant",
      content:
        "The safest first refactor target is the execution settings path, which is a strong candidate for a small value object seam that reduces parameter sprawl without changing runtime behavior."
    },
    {
      role: "assistant",
      content:
        "That gives us a concrete first slice, a stable constraint set, and enough repo grounding to write the initial planning pack without guessing."
    },
    {
      role: "user",
      content: "Yes, go with that seam and write the pack."
    }
  ]);

  const state = await readPlanningPackState(workspace);

  assert.equal(state.mode, "Ready to Draft");
  assert.equal(state.readiness.score, 5);
  assert.equal(state.readiness.readyForFirstDraft, true);
  assert.equal(state.readiness.readyToWrite, true);
  assert.equal(state.readiness.readyToDice, false);
});

test("readPlanningPackState marks approved baselines stale after a later draft refresh", async () => {
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
  assert.equal(state.mode, "Approved - Stale");
  assert.equal(state.readiness.readyToDice, false);
  assert.equal(state.readiness.readyToApprove, true);
});
