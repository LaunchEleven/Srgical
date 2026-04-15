import test from "node:test";
import assert from "node:assert/strict";
import { runOperateCommand } from "../../src/commands/operate";
import { runRunNextCommand } from "../../src/commands/run-next";
import {
  resetAgentAdaptersForTesting,
  setAgentAdaptersForTesting,
  type AgentAdapter,
  type AgentStatus
} from "../../src/core/agent";
import { updatePlanManifest } from "../../src/core/plan-manifest";
import { applyPlanningPackDocumentState } from "../../src/core/planning-doc-state";
import { recordPlanningPackWrite, setHumanWriteConfirmation } from "../../src/core/planning-state";
import { loadStoredActiveAgentId, saveStoredActiveAgentId } from "../../src/core/studio-session";
import type { ChatMessage } from "../../src/core/prompts";
import { writeText } from "../../src/core/workspace";
import { captureStdout } from "../helpers/capture";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("operate --dry-run previews the current next step without invoking execution", async () => {
  const workspace = await createTempWorkspace("srgical-operate-dry-");
  await seedReadyPlan(workspace, "proto");

  const output = await captureStdout(async () => {
    await runOperateCommand(workspace, { planId: "proto", dryRun: true });
  });

  assert.match(output, /Execution dry run:/);
  assert.match(output, /Next step: SPIKE-001 \(Phase 1 - Proof\)/);
  assert.match(output, /Prompt preview: first/);
  assert.match(output, /Dry run only: Codex was not invoked and no execution state or run log was updated\./);
});

test("operate refuses to continue when no next step is queued", async () => {
  const workspace = await createTempWorkspace("srgical-operate-none-");
  const paths = await seedReadyPlan(workspace, "proto");

  await writeText(
    paths.tracker,
    `# Tracker

## Current Position

- Last completed: \`SPIKE-001\`
- Next step: none queued
- Updated at: \`2026-04-05T00:02:00.000Z\`
- Updated by: \`srgical\`

## Phase 1 - Proof

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPIKE-001 | spike | done | BOOT-001 | Prove the tracker rewrite preserves the next-step contract. | The tracker shows a stable next action. | npm test -- test/core/planning-pack-state.test.ts | Completed. |
`
  );

  await assert.rejects(
    () => runOperateCommand(workspace, { planId: "proto", checkpoint: true }),
    /No next step is currently queued in `.srgical\/plans\/<id>\/tracker\.md`\./
  );
});

test("operate honors a temporary agent override without changing the stored selection", async (t) => {
  const workspace = await createTempWorkspace("srgical-operate-override-");
  await seedReadyPlan(workspace, "proto");
  const calls: string[] = [];

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex"),
      onRunNextPrompt: async () => {
        calls.push("codex");
        return "codex-run";
      }
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: availableStatus("claude", "Claude Code"),
      onRunNextPrompt: async () => {
        calls.push("claude");
        return "claude-run";
      }
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  await saveStoredActiveAgentId(workspace, "codex", { planId: "proto" });

  const output = await captureStdout(async () => {
    await runOperateCommand(workspace, { planId: "proto", agent: "claude" });
  });

  assert.deepEqual(calls, ["claude"]);
  assert.match(output, /Running the next step through claude\.\.\./);
  assert.match(output, /claude-run/);
  assert.equal(await loadStoredActiveAgentId(workspace, { planId: "proto" }), "codex");
});

test("run-next is kept only to explain the rebooted workflow", async () => {
  await assert.rejects(() => runRunNextCommand(), /Use `srgical operate <id>` instead\./);
});

async function seedReadyPlan(workspace: string, planId: string) {
  const paths = await writePlanningPack(workspace, { planId });

  await applyPlanningPackDocumentState(paths, "grounded");
  await recordPlanningPackWrite(workspace, "dice", { planId });
  await setHumanWriteConfirmation(workspace, true, { planId });
  await writeText(
    paths.tracker,
    `# Tracker

## Current Position

- Last completed: \`BOOT-001\`
- Next step: \`SPIKE-001\`
- Updated at: \`2026-04-05T00:00:00.000Z\`
- Updated by: \`srgical\`

## Phase 1 - Proof

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BOOT-001 | research | done | - | Create the new prepare pack scaffold. | The visible plan files exist. | Scaffold files written successfully. | Completed during pack creation. |
| SPIKE-001 | spike | todo | BOOT-001 | Prove the tracker rewrite preserves the next-step contract. | The tracker shows a stable next action and validation rule. | npm test -- test/core/planning-pack-state.test.ts | Validate the seam before build work. |
`
  );
  await updatePlanManifest(
    workspace,
    {
      stage: "ready",
      nextAction: "Open operate and run the next step.",
      nextStepId: "SPIKE-001",
      stepCounts: {
        todo: 1,
        doing: 0,
        blocked: 0,
        done: 1,
        skipped: 0,
        total: 2
      },
      lastChangeSummary: "Ready to operate on SPIKE-001.",
      contextReady: true,
      approvedAt: "2026-04-05T00:01:00.000Z"
    },
    { planId }
  );

  return paths;
}

function createFakeAdapter(options: {
  id: string;
  label: string;
  status: AgentStatus;
  onRunNextPrompt?: () => Promise<string>;
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
    async writePlanningPack(): Promise<string> {
      return `${options.id}-pack`;
    },
    async dicePlanningPack(): Promise<string> {
      return `${options.id}-dice`;
    },
    async runNextPrompt(): Promise<string> {
      if (options.onRunNextPrompt) {
        return options.onRunNextPrompt();
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
