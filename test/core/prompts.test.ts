import test from "node:test";
import assert from "node:assert/strict";
import { buildPlannerPrompt, type ChatMessage } from "../../src/core/prompts";
import type { PlanningPackState } from "../../src/core/planning-pack-state";

test("build-planner-prompt enforces convergence and working-plan contract", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "We should skip export and keep this browser-only." },
    { role: "assistant", content: "Locked. One scope lock: desktop-only for V1?" },
    { role: "user", content: "yes absolutely" }
  ];

  const prompt = buildPlannerPrompt(messages, "G:\\code\\demo", createPackState());

  assert.match(prompt, /Operating mode: decision sprint, not endless discovery\./);
  assert.match(prompt, /Run a lightweight internal sufficiency check before asking a question/);
  assert.match(prompt, /If 4 out of 5 sufficiency signals are present, move forward with assumptions/);
  assert.match(prompt, /Blocker-question budget across this conversation: 3/);
  assert.match(prompt, /Estimated blocker questions already asked by planner: 1/);
  assert.match(prompt, /User readiness signal detected: yes/);
  assert.match(prompt, /Deterministic planning state:/);
  assert.match(prompt, /If the only missing signal is explicit approval/);
  assert.match(prompt, /Planning framework wrapper:/);
  assert.match(prompt, /Apply SOLID pragmatically/);
  assert.match(prompt, /Mode B - Working plan snapshot/);
  assert.match(prompt, /Mode C - Locked plan summary/);
  assert.match(prompt, /- run \/write/);
});

test("build-planner-prompt blocks further questioning when budget is exhausted", () => {
  const messages: ChatMessage[] = [
    { role: "assistant", content: "Question one?" },
    { role: "assistant", content: "Question two?" },
    { role: "assistant", content: "Question three?" }
  ];

  const prompt = buildPlannerPrompt(messages, "G:\\code\\demo");

  assert.match(prompt, /Estimated blocker questions already asked by planner: 3/);
  assert.match(prompt, /Remaining blocker questions: 0/);
  assert.match(prompt, /you must not ask another question; produce closure/i);
});

function createPackState(): PlanningPackState {
  return {
    planId: "proto",
    packDir: ".srgical/plans/proto",
    packPresent: true,
    trackerReadable: true,
    docsPresent: 0,
    currentPosition: {
      lastCompleted: "BOOT-001",
      nextRecommended: "PLAN-001",
      updatedAt: "2026-04-03T00:00:00.000Z"
    },
    nextStepSummary: {
      id: "PLAN-001",
      status: "pending",
      dependsOn: "BOOT-001",
      scope: "Write the first grounded draft.",
      acceptance: "The planning pack becomes grounded and specific.",
      notes: "Pending user approval.",
      phase: "Planning"
    },
    lastExecution: null,
    planningState: null,
    packMode: "scaffolded",
    readiness: {
      checks: [],
      score: 4,
      total: 5,
      approvalCaptured: false,
      readyForFirstDraft: true,
      readyToWrite: false,
      missingLabels: ["Explicit go-ahead captured"]
    },
    humanWriteConfirmed: false,
    humanWriteConfirmedAt: null,
    advice: null,
    autoRun: null,
    executionActivated: false,
    mode: "Gathering Context",
    hasFailureOverlay: false
  };
}
