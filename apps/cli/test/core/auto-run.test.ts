import test from "node:test";
import assert from "node:assert/strict";
import {
  resetAgentAdaptersForTesting,
  setAgentAdaptersForTesting,
  type AgentAdapter,
  type AgentInvocationOptions,
  type AgentStatus
} from "../../src/core/agent";
import { executeAutoRun } from "../../src/core/auto-run";
import { updatePlanManifest } from "../../src/core/plan-manifest";
import { applyPlanningPackDocumentState } from "../../src/core/planning-doc-state";
import { recordPlanningPackWrite, setHumanWriteConfirmation } from "../../src/core/planning-state";
import type { ChatMessage } from "../../src/core/prompts";
import type { PlanDiceOptions } from "../../src/core/plan-dicing";
import { writeText } from "../../src/core/workspace";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("execute-auto-run forwards live output chunks from execution attempts", async (t) => {
  const workspace = await createTempWorkspace("srgical-auto-run-stream-");
  const planPaths = await seedAutoRunnablePlan(workspace);
  const streamedChunks: string[] = [];

  await writeText(
    planPaths.tracker,
    `# Tracker

## Current Position

- Last completed: \`PLAN-001\`
- Next step: \`EXEC-001\`
- Updated at: \`2026-04-04T00:00:00.000Z\`
- Updated by: \`srgical\`

## Delivery

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXEC-001 | build | todo | PLAN-001 | Execute the first slice. | The first slice lands. | npm test | Pending. |
`
  );

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex"),
      onRunNextPrompt: async (_workspaceRoot, _prompt, options) => {
        options?.onOutputChunk?.("stream chunk 1\n");
        options?.onOutputChunk?.("stream chunk 2\n");
        await writeText(
          planPaths.tracker,
          `# Tracker

## Current Position

- Last completed: \`EXEC-001\`
- Next step: none queued
- Updated at: \`2026-04-04T00:01:00.000Z\`
- Updated by: \`srgical\`

## Delivery

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXEC-001 | build | done | PLAN-001 | Execute the first slice. | The first slice lands. | npm test | Completed. |
`
        );
        return "completed exec-001";
      }
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  const result = await executeAutoRun(workspace, {
    source: "studio",
    maxSteps: 3,
    onOutputChunk: (chunk) => {
      streamedChunks.push(chunk);
    }
  });

  assert.equal(result.finalState.status, "completed");
  assert.equal(result.summary, "Auto mode completed because no next recommended step remains.");
  assert.deepEqual(streamedChunks, ["stream chunk 1\n", "stream chunk 2\n"]);
});

test("execute-auto-run derives max steps from the remaining execution plan when none is provided", async (t) => {
  const workspace = await createTempWorkspace("srgical-auto-run-derived-max-");
  const planPaths = await seedAutoRunnablePlan(workspace);
  const messages: string[] = [];

  await writeText(
    planPaths.tracker,
    `# Tracker

## Current Position

- Last completed: \`EXEC-001\`
- Next step: \`EXEC-002\`
- Updated at: \`2026-04-04T00:00:00.000Z\`
- Updated by: \`srgical\`

## Delivery

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXEC-001 | build | done | PLAN-001 | Execute the first slice. | The first slice lands. | npm test | Completed. |
| EXEC-002 | build | todo | EXEC-001 | Execute the second slice. | The second slice lands. | npm test | Pending. |
| EXEC-003 | build | todo | EXEC-002 | Execute the third slice. | The third slice lands. | npm test | Pending. |
`
  );

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex"),
      onRunNextPrompt: async () => "no-op"
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  const runPromise = executeAutoRun(workspace, {
    source: "studio",
    onMessage: async (line) => {
      messages.push(line);
      if (line.startsWith("Auto iteration 1/")) {
        throw new Error("stop after first iteration");
      }
    }
  });

  await assert.rejects(() => runPromise, /stop after first iteration/);
  assert.match(messages[0] ?? "", /Auto mode started for plan `default` with max 2 steps\./);
  assert.match(messages.find((line) => line.startsWith("Auto iteration")) ?? "", /Auto iteration 1\/2:/);
});

function createFakeAdapter(options: {
  id: string;
  label: string;
  status: AgentStatus;
  onRunNextPrompt?: (workspaceRoot: string, prompt: string, options?: AgentInvocationOptions) => Promise<string>;
}): AgentAdapter {
  return {
    id: options.id,
    label: options.label,
    async detectStatus(): Promise<AgentStatus> {
      return options.status;
    },
    async requestPlannerReply(_workspaceRoot: string, _messages: ChatMessage[]): Promise<string> {
      return `${options.id}-planner`;
    },
    async requestPlanningAdvice(): Promise<string> {
      return JSON.stringify({
        version: 1,
        problemStatement: "fake",
        clarity: "mostly clear",
        stateAssessment: "fake",
        researchNeeded: [],
        advice: "fake",
        nextAction: "fake"
      });
    },
    async dicePlanningPack(
      _workspaceRoot: string,
      _messages: ChatMessage[],
      _diceOptions: PlanDiceOptions
    ): Promise<string> {
      return `${options.id}-dice`;
    },
    async writePlanningPack(): Promise<string> {
      return `${options.id}-pack`;
    },
    async runNextPrompt(workspaceRoot: string, prompt: string, invocationOptions?: AgentInvocationOptions): Promise<string> {
      if (options.onRunNextPrompt) {
        return options.onRunNextPrompt(workspaceRoot, prompt, invocationOptions);
      }

      return `${options.id}-run`;
    }
  };
}

function availableStatus(id: string, label: string): AgentStatus {
  return {
    id,
    label,
    available: true,
    command: `${id}.cmd`,
    version: "1.0.0"
  };
}

async function seedAutoRunnablePlan(workspace: string) {
  const paths = await writePlanningPack(workspace);

  await applyPlanningPackDocumentState(paths, "grounded");
  await recordPlanningPackWrite(workspace, "dice");
  await setHumanWriteConfirmation(workspace, true);
  await updatePlanManifest(workspace, {
    stage: "ready",
    nextAction: "Open operate and run the next step.",
    contextReady: true,
    approvedAt: "2026-04-04T00:00:00.000Z"
  });

  return paths;
}
