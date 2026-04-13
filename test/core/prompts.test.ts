import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { buildContextRefreshPrompt, buildPackWriterPrompt, buildPlanDicePrompt, buildPlannerPrompt, type ChatMessage } from "../../src/core/prompts";
import type { PlanningPackState } from "../../src/core/planning-pack-state";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("build-planner-prompt enforces convergence and the new prepare actions", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "We should keep this workflow local-first and make the next action obvious after every refinement." },
    { role: "assistant", content: "Locked. The visible contract is prepare for shaping and operate for execution. Any blocker before we build the draft?" },
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
  assert.match(prompt, /ready for Build Draft, Slice Plan, or approval/i);
  assert.match(prompt, /Build Draft/);
  assert.match(prompt, /Slice Plan/);
  assert.match(prompt, /Approve Ready/);
  assert.doesNotMatch(prompt, /\/write/);
  assert.doesNotMatch(prompt, /\/confirm-plan/);
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

test("build-pack-writer-prompt references the rebooted prepare pack files", async () => {
  const workspace = await createTempWorkspace("srgical-pack-writer-prompt-");
  await writePlanningPack(workspace, { planId: "proto" });

  const prompt = await buildPackWriterPrompt([{ role: "user", content: "Build the first real draft." }], workspace, { planId: "proto" });

  assert.match(prompt, /You are writing a prepare pack for the current repository\./);
  assert.match(prompt, /plan\.md/);
  assert.match(prompt, /context\.md/);
  assert.match(prompt, /tracker\.md/);
  assert.match(prompt, /changes\.md/);
  assert.match(prompt, /manifest\.json/);
  assert.match(prompt, /tracker\.md must use only these statuses: todo, doing, blocked, done, skipped\./);
  assert.match(prompt, /Type column using research, spike, build, validate, or rollout/);
});

test("build-pack-writer-prompt includes deep context evidence beyond the old short snippet window", async () => {
  const workspace = await createTempWorkspace("srgical-pack-writer-context-window-");
  const paths = await writePlanningPack(workspace, { planId: "proto" });
  const deepAnchor = "DEEP_CONTEXT_ANCHOR";
  const expandedContext = [
    "<!-- SRGICAL:DOC_STATE {\"version\":1,\"docKey\":\"context\",\"state\":\"grounded\"} -->",
    "",
    "# Context",
    "",
    "## Evidence Gathered",
    "",
    `${"x".repeat(7000)}${deepAnchor}`
  ].join("\n");

  await writeFile(paths.context, expandedContext, "utf8");

  const prompt = await buildPackWriterPrompt([{ role: "user", content: "Refresh the draft." }], workspace, { planId: "proto" });

  assert.match(prompt, new RegExp(deepAnchor));
});

test("build-context-refresh-prompt focuses on updating the living context doc", async () => {
  const workspace = await createTempWorkspace("srgical-context-refresh-prompt-");
  await writePlanningPack(workspace, { planId: "proto" });

  const prompt = await buildContextRefreshPrompt(
    [{ role: "user", content: "Read this exported planning document and sync it into context.md." }],
    workspace,
    [
      {
        path: "notes/exported-chat.md",
        content: "# Exported Notes\n\n- Desired outcome: make context.md stay current.\n- Next: build the draft after sync."
      }
    ],
    { planId: "proto" }
  );

  assert.match(prompt, /updating the living context document/i);
  assert.match(prompt, /Update only this file under \.srgical\/:\s+\n\s*- context\.md/i);
  assert.match(prompt, /Do not claim you are blocked from writing context\.md/i);
  assert.match(prompt, /Treat context\.md as a living working document/i);
  assert.match(prompt, /New source material to integrate:/);
  assert.match(prompt, /notes\/exported-chat\.md/);
});

test("build-plan-dice-prompt includes requested resolution and optional spike mode", async () => {
  const workspace = await createTempWorkspace("srgical-dice-prompt-");
  await writePlanningPack(workspace, { planId: "proto" });

  const prompt = await buildPlanDicePrompt(
    [{ role: "user", content: "Slice this into tiny safe steps and add a spike if the seam is risky." }],
    workspace,
    {
      resolution: "high",
      allowLiveFireSpike: true
    },
    { planId: "proto" }
  );

  assert.match(prompt, /requested resolution: high/);
  assert.match(prompt, /live-fire spike mode: enabled/);
  assert.match(prompt, /very fine-grained evolutionary slices/i);
  assert.match(prompt, /SPIKE-###/);
  assert.match(prompt, /changes\.md should summarize what changed in this slice refinement\./);
});

function createPackState(): PlanningPackState {
  return {
    planId: "proto",
    packDir: ".srgical/plans/proto",
    packPresent: true,
    legacyPackPresent: false,
    trackerReadable: true,
    docsPresent: 5,
    remainingExecutionSteps: 1,
    currentPosition: {
      lastCompleted: "BOOT-001",
      nextRecommended: "SPIKE-001",
      updatedAt: "2026-04-03T00:00:00.000Z"
    },
    nextStepSummary: {
      id: "SPIKE-001",
      type: "spike",
      status: "todo",
      dependsOn: "BOOT-001",
      scope: "Validate the risky seam before build work.",
      acceptance: "We know whether the seam is safe enough to implement.",
      validation: "npm test -- test/core/planning-pack-state.test.ts",
      notes: "Pending first proof.",
      phase: "Phase 1 - Proof"
    },
    lastExecution: null,
    planningState: null,
    packMode: "authored",
    draftState: "sliced",
    readiness: {
      checks: [],
      score: 4,
      total: 5,
      approvalCaptured: false,
      readyForFirstDraft: true,
      readyToWrite: true,
      readyToDice: true,
      readyToApprove: true,
      missingLabels: ["Explicit go-ahead captured"]
    },
    humanWriteConfirmed: false,
    humanWriteConfirmedAt: null,
    approvalStatus: "pending",
    approvalInvalidatedBy: null,
    lastWriteAt: null,
    lastDiceAt: null,
    advice: null,
    autoRun: null,
    executionActivated: false,
    mode: "Prepare",
    hasFailureOverlay: false,
    manifest: null,
    evidence: ["src/ui/studio.ts"],
    unknowns: ["Need one more approval signal before operate."],
    nextAction: "Review the sliced tracker, then approve when it is clear enough to operate."
  };
}
