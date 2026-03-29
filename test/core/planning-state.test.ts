import test from "node:test";
import assert from "node:assert/strict";
import {
  hasHumanWriteConfirmation,
  loadPlanningState,
  markPlanningPackAuthored,
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

test("markPlanningPackAuthored clears the write confirmation gate for the next planning cycle", async () => {
  const workspace = await createTempWorkspace("srgical-planning-state-clear-");
  await writePlanningPack(workspace);
  await savePlanningState(workspace, "scaffolded");
  await setHumanWriteConfirmation(workspace, true);

  await markPlanningPackAuthored(workspace);
  const authoredState = await loadPlanningState(workspace);

  assert.equal(authoredState?.packMode, "authored");
  assert.equal(hasHumanWriteConfirmation(authoredState ?? null), false);
  assert.equal(authoredState?.humanConfirmedForWriteAt, null);
});
