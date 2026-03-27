import test from "node:test";
import assert from "node:assert/strict";
import { runDoctorCommand } from "../../src/commands/doctor";
import {
  resetAgentAdaptersForTesting,
  setAgentAdaptersForTesting,
  type AgentAdapter,
  type AgentStatus
} from "../../src/core/agent";
import type { ChatMessage } from "../../src/core/prompts";
import { saveStoredActiveAgentId } from "../../src/core/studio-session";
import { writeText } from "../../src/core/workspace";
import { captureStdout } from "../helpers/capture";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("doctor reports all supported agents and the queued next step", async (t) => {
  const workspace = await createTempWorkspace("srgical-doctor-next-");
  const paths = await writePlanningPack(workspace);

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex", "0.113.0")
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: availableStatus("claude", "Claude Code", "1.2.3")
    }),
    createFakeAdapter({
      id: "augment",
      label: "Augment CLI",
      status: availableStatus("augment", "Augment CLI", "2.0.0")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  await saveStoredActiveAgentId(workspace, "claude");

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`PACK002\`
- Next Recommended: \`EXEC001\`
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`

## Execution

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC001 | pending | PACK002 | Summarize the next step. | The next step is visible before execution. | Pending command output work. |
`
  );

  const output = await captureStdout(async () => {
    await runDoctorCommand(workspace);
  });

  assert.match(output, /Planning pack: present/);
  assert.match(output, /Active agent: Claude Code \(claude\) - available \(1\.2\.3\)/);
  assert.match(output, /Supported agents:/);
  assert.match(output, /- Codex \(codex\): available \(0\.113\.0\) via codex\.cmd/);
  assert.match(output, /- Claude Code \(claude\) \[active\]: available \(1\.2\.3\) via claude\.cmd/);
  assert.match(output, /- Augment CLI \(augment\): available \(2\.0\.0\) via augment\.cmd/);
  assert.match(output, /Next Step: EXEC001 \(Execution\)/);
  assert.match(output, /Next move: run `srgical studio` to refine the plan or `srgical run-next` to execute the next step\./);
});

test("doctor reports missing supported agents safely when no next step is queued", async (t) => {
  const workspace = await createTempWorkspace("srgical-doctor-none-");
  const paths = await writePlanningPack(workspace);

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: unavailableStatus("codex", "Codex", "missing codex")
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: unavailableStatus("claude", "Claude Code", "missing claude")
    }),
    createFakeAdapter({
      id: "augment",
      label: "Augment CLI",
      status: unavailableStatus("augment", "Augment CLI", "missing augment")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`DIST001\`
- Next Recommended: none queued
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`
`
  );

  const output = await captureStdout(async () => {
    await runDoctorCommand(workspace);
  });

  assert.match(output, /Active agent: Codex \(codex\) - missing \(missing codex\)/);
  assert.match(output, /- Codex \(codex\) \[active\]: missing \(missing codex\) via codex\.cmd/);
  assert.match(output, /- Claude Code \(claude\): missing \(missing claude\) via claude\.cmd/);
  assert.match(output, /- Augment CLI \(augment\): missing \(missing augment\) via augment\.cmd/);
  assert.match(output, /Next Step: unavailable/);
  assert.match(output, /Tracker does not currently expose a next recommended step\./);
  assert.match(output, /Next move: run `srgical studio` to queue more work or update the tracker with a new recommended step\./);
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
    async writePlanningPack(): Promise<string> {
      return `${options.id}-pack`;
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

function unavailableStatus(id: string, label: string, error: string): AgentStatus {
  return {
    id,
    label,
    available: false,
    command: `${id}.cmd`,
    error
  };
}
