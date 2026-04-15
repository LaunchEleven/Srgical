import test from "node:test";
import assert from "node:assert/strict";
import { parsePlanDiceCommand, parsePlanDiceIntent, renderPlanDiceHelp, renderPlanDiceLabel } from "../../src/core/plan-dicing";

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

test("parse-plan-dice-intent supports slice and legacy dice help requests", () => {
  assert.deepEqual(parsePlanDiceIntent(":slice"), {
    command: ":slice",
    options: {
      resolution: "high",
      allowLiveFireSpike: true
    },
    helpRequested: false
  });
  assert.deepEqual(parsePlanDiceIntent(":slice low --help"), {
    command: ":slice",
    options: {
      resolution: "low",
      allowLiveFireSpike: false
    },
    helpRequested: true
  });
  assert.deepEqual(parsePlanDiceIntent("/dice high spike --help"), {
    command: "/dice",
    options: {
      resolution: "high",
      allowLiveFireSpike: true
    },
    helpRequested: true
  });
});

test("render-plan-dice-help explains the slice options and defaults", () => {
  const help = renderPlanDiceHelp(":slice");

  assert.match(help, /Usage: `:slice \[low\|medium\|high\] \[spike\]`/);
  assert.match(help, /No args: high \+ spike/);
  assert.match(help, /`low`: coarse slicing with fewer, larger step blocks/);
  assert.match(help, /`medium`: balanced slicing with practical PR-sized steps/);
  assert.match(help, /`high`: very fine-grained slicing with the smallest practical execution steps/);
  assert.match(help, /`spike`: allows an explicit `SPIKE-###` proof step/);
});
