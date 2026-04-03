import test from "node:test";
import assert from "node:assert/strict";
import {
  hasHumanWriteConfirmation,
  loadPlanningState,
  recordPlanningPackWrite,
  savePlanningState,
  setHumanWriteConfirmation
} from "../../src/core/planning-state";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("setHumanWriteConfirmation records explicit human approval for writing", async () => {
  const workspace = await createTempWorkspace("srgical-planning-state-confirm-");
  await writePlanningPack(workspace);
  await savePlanningState(workspace, "scaffolded");

  const confirmedState = await setHumanWriteConfirmation(workspace, true);

  assert.equal(hasHumanWriteConfirmation(confirmedState), true);
  assert.match(confirmedState.humanConfirmedForWriteAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("recordPlanningPackWrite keeps draft iteration open after approval and marks approval stale", async () => {
  const workspace = await createTempWorkspace("srgical-planning-state-clear-");
  await writePlanningPack(workspace);
  await savePlanningState(workspace, "scaffolded");
  await setHumanWriteConfirmation(workspace, true);

  await recordPlanningPackWrite(workspace, "write");
  const authoredState = await loadPlanningState(workspace);

  assert.equal(authoredState?.packMode, "authored");
  assert.equal(authoredState?.draftState, "written");
  assert.equal(authoredState?.approvalStatus, "stale");
  assert.equal(authoredState?.approvalInvalidatedBy, "write");
  assert.equal(hasHumanWriteConfirmation(authoredState ?? null), false);
  assert.match(authoredState?.humanConfirmedForWriteAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("recordPlanningPackWrite marks diced drafts distinctly", async () => {
  const workspace = await createTempWorkspace("srgical-planning-state-dice-");
  await writePlanningPack(workspace);
  await savePlanningState(workspace, "scaffolded");

  await recordPlanningPackWrite(workspace, "dice");
  const state = await loadPlanningState(workspace);

  assert.equal(state?.packMode, "authored");
  assert.equal(state?.draftState, "sliced");
  assert.equal(state?.approvalStatus, "pending");
  assert.equal(state?.approvalInvalidatedBy, null);
  assert.match(state?.lastDiceAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});
