import test from "node:test";
import assert from "node:assert/strict";
import { parsePlanDiceCommand, renderPlanDiceLabel } from "../../src/core/plan-dicing";

test("parse-plan-dice-command defaults to medium resolution without spike", () => {
  assert.deepEqual(parsePlanDiceCommand("/dice"), {
    resolution: "medium",
    allowLiveFireSpike: false
  });
});

test("parse-plan-dice-command supports resolution and optional spike tokens", () => {
  assert.deepEqual(parsePlanDiceCommand("/dice high spike"), {
    resolution: "high",
    allowLiveFireSpike: true
  });
  assert.deepEqual(parsePlanDiceCommand("/dice spike low"), {
    resolution: "low",
    allowLiveFireSpike: true
  });
});

test("parse-plan-dice-command rejects unsupported arguments", () => {
  assert.equal(parsePlanDiceCommand("/dice hires"), null);
});

test("render-plan-dice-label includes spike when enabled", () => {
  assert.equal(renderPlanDiceLabel({ resolution: "medium", allowLiveFireSpike: false }), "medium");
  assert.equal(renderPlanDiceLabel({ resolution: "high", allowLiveFireSpike: true }), "high + spike");
});
