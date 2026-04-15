import test from "node:test";
import assert from "node:assert/strict";
import { runDoctorCommand } from "../../src/commands/doctor";
import { runStatusCommand } from "../../src/commands/status";
import {
  resetAgentAdaptersForTesting,
  setAgentAdaptersForTesting,
  type AgentAdapter,
  type AgentStatus
} from "../../src/core/agent";
import { updatePlanManifest } from "../../src/core/plan-manifest";
import { recordPlanningPackWrite, setHumanWriteConfirmation } from "../../src/core/planning-state";
import { applyPlanningPackDocumentState } from "../../src/core/planning-doc-state";
import { saveStoredActiveAgentId } from "../../src/core/studio-session";
import type { ChatMessage } from "../../src/core/prompts";
import { writeText } from "../../src/core/workspace";
import { captureStdout } from "../helpers/capture";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("status reports the selected plan stage, next action, and visible change summary", async (t) => {
  const workspace = await createTempWorkspace("srgical-status-selected-");
  const paths = await writePlanningPack(workspace, { planId: "proto" });

  await applyPlanningPackDocumentState(paths, "grounded");
  await recordPlanningPackWrite(workspace, "dice", { planId: "proto" });
  await setHumanWriteConfirmation(workspace, true, { planId: "proto" });
  await saveStoredActiveAgentId(workspace, "claude", { planId: "proto" });
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
| SPIKE-001 | spike | todo | BOOT-001 | Prove the tracker rewrite preserves the next-step contract. | We can show the next step and validation rules cleanly. | npm test -- test/core/planning-pack-state.test.ts | Validate tracker output before downstream build steps. |
| BUILD-001 | build | todo | SPIKE-001 | Implement the polished prepare status panel. | The panel shows stage, unknowns, and the next action. | npm test -- test/commands/doctor.test.ts | Wait for the spike result first. |
`
  );
  await updatePlanManifest(
    workspace,
    {
      stage: "ready",
      nextAction: "Open operate and run the next step.",
      nextStepId: "SPIKE-001",
      stepCounts: {
        todo: 2,
        doing: 0,
        blocked: 0,
        done: 1,
        skipped: 0,
        total: 3
      },
      lastChangeSummary: "Tracker updated: inserted SPIKE-001 before BUILD-001.",
      evidence: ["src/ui/studio.ts", "docs/studio-plan-tutorial.md"],
      unknowns: ["Whether the spike proves the tracker output is stable enough to build on."],
      executionMode: "step",
      contextReady: true,
      approvedAt: "2026-04-05T00:01:00.000Z"
    },
    { planId: "proto" }
  );

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: availableStatus("claude", "Claude Code", "1.2.3")
    }),
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex", "0.113.0")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  const output = await captureStdout(async () => {
    await runStatusCommand(workspace, { planId: "proto" });
  });

  assert.match(output, /Active plan: proto/);
  assert.match(output, /Active agent: Claude Code \(claude\)/);
  assert.match(output, /- proto \[active\]: stage Ready \| next action Open operate and run the next step\./);
  assert.match(output, /Stage: Ready/);
  assert.match(output, /Next action: Open operate and run the next step\./);
  assert.match(output, /Next step: SPIKE-001/);
  assert.match(output, /Last change: Tracker updated: inserted SPIKE-001 before BUILD-001\./);
  assert.match(output, /Evidence: src\/ui\/studio\.ts \| docs\/studio-plan-tutorial\.md/);
  assert.match(output, /Unknowns: Whether the spike proves the tracker output is stable enough to build on\./);
  assert.match(output, /Execution mode: step/);
});

test("status stays helpful before any plan has been created", async (t) => {
  const workspace = await createTempWorkspace("srgical-status-empty-");

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex", "0.113.0")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  const output = await captureStdout(async () => {
    await runStatusCommand(workspace);
  });

  assert.match(output, /Active plan: none/);
  assert.match(output, /No plans yet\. Start with `srgical prepare <id>`\./);
  assert.match(output, /Next: run `srgical prepare <id>` to create or open a plan\./);
});

test("doctor is kept only to explain the rebooted workflow", async () => {
  await assert.rejects(() => runDoctorCommand(), /Use `srgical status <id>` instead\./);
});

function createFakeAdapter(options: {
  id: string;
  label: string;
  status: AgentStatus;
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
      return `${options.id}-run`;
    }
  };
}

function availableStatus(id: string, label: string, version: string): AgentStatus {
  return {
    id,
    label,
    available: true,
    command: `${id}.cmd`,
    version
  };
}
