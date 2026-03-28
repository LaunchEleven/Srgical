import test from "node:test";
import assert from "node:assert/strict";
import { runRunNextCommand } from "../../src/commands/run-next";
import {
  resetAgentAdaptersForTesting,
  setAgentAdaptersForTesting,
  type AgentAdapter,
  type AgentStatus
} from "../../src/core/agent";
import { loadAutoRunState } from "../../src/core/auto-run-state";
import type { ChatMessage } from "../../src/core/prompts";
import { loadStoredActiveAgentId, saveStoredActiveAgentId } from "../../src/core/studio-session";
import { getPlanningPackPaths, readText, writeText } from "../../src/core/workspace";
import { captureStdout } from "../helpers/capture";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("run-next --dry-run previews the execution without writing state", async () => {
  const workspace = await createTempWorkspace("srgical-run-next-dry-");
  const paths = await writePlanningPack(workspace);

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
    await runRunNextCommand(workspace, { dryRun: true });
  });

  assert.match(output, /Execution dry run:/);
  assert.match(output, /Next step: EXEC001 \(Execution\)/);
  assert.match(output, /Dry run only: Codex was not invoked and no execution state or run log was updated\./);
});

test("run-next refuses to execute when the tracker has no queued next step", async () => {
  const workspace = await createTempWorkspace("srgical-run-next-none-");
  const paths = await writePlanningPack(workspace);

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

  await assert.rejects(
    () => runRunNextCommand(workspace),
    /No next recommended step is currently queued in `.srgical\/03-detailed-implementation-plan.md`\./
  );
});

test("run-next --dry-run honors the stored workspace agent selection", async (t) => {
  const workspace = await createTempWorkspace("srgical-run-next-agent-");
  const paths = await writePlanningPack(workspace);

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex")
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: availableStatus("claude", "Claude Code")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  await saveStoredActiveAgentId(workspace, "claude");

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`ADAPT002\`
- Next Recommended: \`SESSION001\`
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`

## Phase 5 - Multi-Agent Launch Compatibility

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| SESSION001 | pending | ADAPT002 | Persist the active agent. | The workspace keeps the session selection. | Pending session work. |
`
  );

  const output = await captureStdout(async () => {
    await runRunNextCommand(workspace, { dryRun: true });
  });

  assert.match(output, /Dry run only: Claude Code was not invoked and no execution state or run log was updated\./);
});

test("run-next --dry-run honors a temporary agent override without changing the stored selection", async (t) => {
  const workspace = await createTempWorkspace("srgical-run-next-override-dry-");
  const paths = await writePlanningPack(workspace);

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex")
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: availableStatus("claude", "Claude Code")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  await saveStoredActiveAgentId(workspace, "claude");

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`ADAPT003\`
- Next Recommended: \`EXEC004\`
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`

## Phase 5 - Multi-Agent Launch Compatibility

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC004 | pending | ADAPT003, SESSION001 | Honor the execution agent override. | The user can override the agent for one run. | Pending override work. |
`
  );

  const output = await captureStdout(async () => {
    await runRunNextCommand(workspace, { dryRun: true, agent: "codex" });
  });

  assert.match(output, /Dry run only: Codex was not invoked and no execution state or run log was updated\./);
  assert.equal(await saveAndReloadStoredAgent(workspace), "claude");
});

test("run-next executes through a temporary agent override for one run", async (t) => {
  const workspace = await createTempWorkspace("srgical-run-next-override-exec-");
  const paths = await writePlanningPack(workspace);
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

  await saveStoredActiveAgentId(workspace, "codex");

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`ADAPT003\`
- Next Recommended: \`EXEC004\`
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`

## Phase 5 - Multi-Agent Launch Compatibility

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC004 | pending | ADAPT003, SESSION001 | Honor the execution agent override. | The user can override the agent for one run. | Pending override work. |
`
  );

  const output = await captureStdout(async () => {
    await runRunNextCommand(workspace, { agent: "claude" });
  });

  assert.deepEqual(calls, ["claude"]);
  assert.match(output, /Running the current next-agent prompt through Claude Code\.\.\./);
  assert.match(output, /claude-run/);
  assert.equal(await saveAndReloadStoredAgent(workspace), "codex");
});

test("run-next --dry-run fails clearly when the override agent is unavailable and preserves the stored selection", async (t) => {
  const workspace = await createTempWorkspace("srgical-run-next-override-missing-");
  const paths = await writePlanningPack(workspace);

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex")
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: unavailableStatus("claude", "Claude Code", "missing claude")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  await saveStoredActiveAgentId(workspace, "codex");

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`ADAPT003\`
- Next Recommended: \`EXEC004\`
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`

## Phase 5 - Multi-Agent Launch Compatibility

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC004 | pending | ADAPT003, SESSION001 | Honor the execution agent override. | The user can override the agent for one run. | Pending override work. |
`
  );

  await assert.rejects(
    () => runRunNextCommand(workspace, { dryRun: true, agent: "claude" }),
    /Cannot use Claude Code for this run: missing claude\./
  );
  assert.equal(await saveAndReloadStoredAgent(workspace), "codex");
});

test("run-next --auto advances through queued execution steps and records completion", async (t) => {
  const workspace = await createTempWorkspace("srgical-run-next-auto-");
  const paths = await writePlanningPack(workspace);

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`PLAN-001\`
- Next Recommended: \`EXEC-001\`
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`

## Delivery

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC-001 | pending | PLAN-001 | Execute the first slice. | The first slice lands. | Pending first slice. |
| EXEC-002 | pending | EXEC-001 | Execute the second slice. | The second slice lands. | Pending second slice. |
`
  );

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex"),
      onRunNextPrompt: async (workspaceRoot: string) => {
        const planPaths = getPlanningPackPaths(workspaceRoot);
        const tracker = await readText(planPaths.tracker);

        if (tracker.includes("- Next Recommended: `EXEC-001`")) {
          await writeText(
            planPaths.tracker,
            `# Detailed Implementation Plan

## Current Position

- Last Completed: \`EXEC-001\`
- Next Recommended: \`EXEC-002\`
- Updated At: \`2026-03-24T00:01:00.000Z\`
- Updated By: \`Codex\`

## Delivery

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC-001 | done | PLAN-001 | Execute the first slice. | The first slice lands. | Completed. |
| EXEC-002 | pending | EXEC-001 | Execute the second slice. | The second slice lands. | Pending second slice. |
`
          );
          return "completed exec-001";
        }

        await writeText(
          planPaths.tracker,
          `# Detailed Implementation Plan

## Current Position

- Last Completed: \`EXEC-002\`
- Next Recommended: none queued
- Updated At: \`2026-03-24T00:02:00.000Z\`
- Updated By: \`Codex\`

## Delivery

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC-001 | done | PLAN-001 | Execute the first slice. | The first slice lands. | Completed. |
| EXEC-002 | done | EXEC-001 | Execute the second slice. | The second slice lands. | Completed. |
`
        );
        return "completed exec-002";
      }
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  const output = await captureStdout(async () => {
    await runRunNextCommand(workspace, { auto: true, maxSteps: 5 });
  });

  const autoRunState = await loadAutoRunState(workspace);

  assert.match(output, /Auto mode started for plan `default` with max 5 steps\./);
  assert.match(output, /Auto mode completed because no next recommended step remains\./);
  assert.equal(autoRunState?.status, "completed");
  assert.equal(autoRunState?.stepsAttempted, 2);
});

function createFakeAdapter(options: {
  id: string;
  label: string;
  status: AgentStatus;
  onRunNextPrompt?: (_workspaceRoot: string, _prompt: string) => Promise<string>;
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
    async runNextPrompt(workspaceRoot: string, prompt: string): Promise<string> {
      if (options.onRunNextPrompt) {
        return options.onRunNextPrompt(workspaceRoot, prompt);
      }

      return `${options.id}-run`;
    }
  };
}

async function saveAndReloadStoredAgent(workspace: string): Promise<string | null> {
  return loadStoredActiveAgentId(workspace);
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

function unavailableStatus(id: string, label: string, error: string): AgentStatus {
  return {
    id,
    label,
    available: false,
    command: `${id}.cmd`,
    error
  };
}
