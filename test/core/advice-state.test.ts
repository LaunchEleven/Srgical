import test from "node:test";
import assert from "node:assert/strict";
import {
  loadPlanningAdviceState,
  parsePlanningAdviceResponse,
  savePlanningAdviceState
} from "../../src/core/advice-state";
import { createTempWorkspace } from "../helpers/workspace";

test("parsePlanningAdviceResponse extracts the JSON advice payload", () => {
  const parsed = parsePlanningAdviceResponse(
    `Here is the assessment:
{
  "version": 1,
  "problemStatement": "Refactor the execution settings seam safely.",
  "clarity": "mostly clear",
  "stateAssessment": "The target seam is known, but the acceptance boundary still needs one more confirmation.",
  "researchNeeded": ["Confirm all call sites of the execution settings helpers."],
  "advice": "Stay focused on the execution settings seam and avoid broad library cleanup right now.",
  "nextAction": "Inspect the seam's call sites and then lock the first refactor slice."
}`,
    "default"
  );

  assert.equal(parsed?.problemStatement, "Refactor the execution settings seam safely.");
  assert.equal(parsed?.clarity, "mostly clear");
  assert.equal(parsed?.researchNeeded.length, 1);
});

test("savePlanningAdviceState and loadPlanningAdviceState round-trip the advice cache", async () => {
  const workspace = await createTempWorkspace("srgical-advice-state-");

  await savePlanningAdviceState(workspace, {
    problemStatement: "Refactor the execution settings seam safely.",
    clarity: "mostly clear",
    stateAssessment: "The target seam is known, but the acceptance boundary still needs one more confirmation.",
    researchNeeded: ["Confirm all call sites of the execution settings helpers."],
    advice: "Stay focused on the execution settings seam and avoid broad library cleanup right now.",
    nextAction: "Inspect the seam's call sites and then lock the first refactor slice."
  });

  const loaded = await loadPlanningAdviceState(workspace);

  assert.equal(loaded?.problemStatement, "Refactor the execution settings seam safely.");
  assert.equal(loaded?.clarity, "mostly clear");
  assert.equal(loaded?.nextAction, "Inspect the seam's call sites and then lock the first refactor slice.");
});
