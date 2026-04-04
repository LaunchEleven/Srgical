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
import type { ChatMessage } from "../../src/core/prompts";
import type { PlanDiceOptions } from "../../src/core/plan-dicing";
import { savePlanningState, setHumanWriteConfirmation } from "../../src/core/planning-state";
import { writeText } from "../../src/core/workspace";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("execute-auto-run forwards live output chunks from execution attempts", async (t) => {
  const workspace = await createTempWorkspace("srgical-auto-run-stream-");
  const planPaths = await writePlanningPack(workspace);
  const streamedChunks: string[] = [];

  await savePlanningState(workspace, "authored");
  await setHumanWriteConfirmation(workspace, true);
  await writeText(
    planPaths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`PLAN-001\`
- Next Recommended: \`EXEC-001\`
- Updated At: \`2026-04-04T00:00:00.000Z\`
- Updated By: \`Codex\`

## Delivery

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC-001 | pending | PLAN-001 | Execute the first slice. | The first slice lands. | Pending. |
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
          `# Detailed Implementation Plan

## Current Position

- Last Completed: \`EXEC-001\`
- Next Recommended: none queued
- Updated At: \`2026-04-04T00:01:00.000Z\`
- Updated By: \`Codex\`

## Delivery

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC-001 | done | PLAN-001 | Execute the first slice. | The first slice lands. | Completed. |
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
