import test from "node:test";
import assert from "node:assert/strict";
import {
  detectPrimaryAgent,
  detectSupportedAgents,
  getPrimaryAgentAdapter,
  requestPlannerReply,
  resolveExecutionAgent,
  resetAgentAdaptersForTesting,
  selectPrimaryAgent,
  setAgentAdaptersForTesting,
  type AgentAdapter,
  type AgentInvocationOptions,
  type AgentStatus
} from "../../src/core/agent";
import type { ChatMessage } from "../../src/core/prompts";
import { loadStoredActiveAgentId, saveStoredActiveAgentId } from "../../src/core/studio-session";
import { createTempWorkspace } from "../helpers/workspace";

test("detect-supported-agents keeps order and resolves the first available adapter as primary", async (t) => {
  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: unavailableStatus("codex", "Codex")
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: availableStatus("claude", "Claude Code")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  const statuses = await detectSupportedAgents();
  const primary = await detectPrimaryAgent();

  assert.deepEqual(
    statuses.map((status) => [status.id, status.available]),
    [
      ["codex", false],
      ["claude", true]
    ]
  );
  assert.equal(primary.id, "claude");
  assert.equal(getPrimaryAgentAdapter().id, "claude");
});

test("detect-primary-agent falls back cleanly when no supported adapter is available", async (t) => {
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
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  const primary = await detectPrimaryAgent();

  assert.equal(primary.id, "codex");
  assert.equal(primary.available, false);
  assert.equal(getPrimaryAgentAdapter().id, "codex");
});

test("planner requests delegate through the resolved primary adapter", async (t) => {
  const calls: string[] = [];

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: unavailableStatus("codex", "Codex"),
      onPlannerReply: async () => {
        calls.push("codex");
        return "codex";
      }
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: availableStatus("claude", "Claude Code"),
      onPlannerReply: async () => {
        calls.push("claude");
        return "claude";
      }
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  const reply = await requestPlannerReply("workspace", [{ role: "user", content: "plan" }]);

  assert.equal(reply, "claude");
  assert.deepEqual(calls, ["claude"]);
});

test("planner requests pass through optional streaming callbacks", async (t) => {
  const chunks: string[] = [];

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex"),
      onPlannerReply: async (_workspaceRoot, _messages, options) => {
        options?.onOutputChunk?.("stream chunk 1");
        options?.onOutputChunk?.("stream chunk 2");
        return "done";
      }
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  const reply = await requestPlannerReply("workspace", [{ role: "user", content: "plan" }], {
    onOutputChunk: (chunk) => {
      chunks.push(chunk);
    }
  });

  assert.equal(reply, "done");
  assert.deepEqual(chunks, ["stream chunk 1", "stream chunk 2"]);
});

test("detect-primary-agent honors the stored workspace session selection", async (t) => {
  const workspace = await createTempWorkspace("srgical-agent-session-");

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

  const statuses = await detectSupportedAgents(workspace);
  const primary = await detectPrimaryAgent(workspace);

  assert.equal(statuses[0].id, "codex");
  assert.equal(primary.id, "claude");
  assert.equal(getPrimaryAgentAdapter().id, "claude");
});

test("detect-primary-agent honors an augment workspace session selection when that adapter is registered", async (t) => {
  const workspace = await createTempWorkspace("srgical-agent-session-augment-");

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
    }),
    createFakeAdapter({
      id: "augment",
      label: "Augment CLI",
      status: availableStatus("augment", "Augment CLI")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  await saveStoredActiveAgentId(workspace, "augment");

  const primary = await detectPrimaryAgent(workspace);

  assert.equal(primary.id, "augment");
  assert.equal(getPrimaryAgentAdapter().id, "augment");
});

test("detect-primary-agent clears a stale stored workspace selection when that adapter is no longer registered", async (t) => {
  const workspace = await createTempWorkspace("srgical-agent-stale-");

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  await saveStoredActiveAgentId(workspace, "claude");

  const primary = await detectPrimaryAgent(workspace);

  assert.equal(primary.id, "codex");
  assert.equal(await loadStoredActiveAgentId(workspace), null);
});

test("select-primary-agent persists the chosen available adapter for the workspace session", async (t) => {
  const workspace = await createTempWorkspace("srgical-agent-select-");

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

  const selected = await selectPrimaryAgent(workspace, "claude");

  assert.equal(selected.status.id, "claude");
  assert.equal(await loadStoredActiveAgentId(workspace), "claude");
  assert.equal((await detectPrimaryAgent(workspace)).id, "claude");
});

test("resolve-execution-agent allows a one-run override without changing the stored workspace session selection", async (t) => {
  const workspace = await createTempWorkspace("srgical-agent-execution-");

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

  const resolved = await resolveExecutionAgent(workspace, "codex");

  assert.equal(resolved.status.id, "codex");
  assert.equal(getPrimaryAgentAdapter().id, "codex");
  assert.equal(await loadStoredActiveAgentId(workspace), "claude");
  assert.equal((await detectPrimaryAgent(workspace)).id, "claude");
});

test("resolve-execution-agent rejects an unavailable override without changing the stored workspace session selection", async (t) => {
  const workspace = await createTempWorkspace("srgical-agent-execution-missing-");

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

  await assert.rejects(
    () => resolveExecutionAgent(workspace, "claude"),
    /Cannot use Claude Code for this run: missing claude\./
  );
  assert.equal(await loadStoredActiveAgentId(workspace), "codex");
  assert.equal((await detectPrimaryAgent(workspace)).id, "codex");
});

function createFakeAdapter(adapterOptions: {
  id: string;
  label: string;
  status: AgentStatus;
  onPlannerReply?: (workspaceRoot: string, messages: ChatMessage[], options?: AgentInvocationOptions) => Promise<string>;
}): AgentAdapter {
  return {
    id: adapterOptions.id,
    label: adapterOptions.label,
    async detectStatus(): Promise<AgentStatus> {
      return adapterOptions.status;
    },
    async requestPlannerReply(workspaceRoot: string, messages: ChatMessage[], invocationOptions?: AgentInvocationOptions): Promise<string> {
      if (adapterOptions.onPlannerReply) {
        return adapterOptions.onPlannerReply(workspaceRoot, messages, invocationOptions);
      }

      return `${adapterOptions.id}-planner`;
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
      return `${adapterOptions.id}-pack`;
    },
    async runNextPrompt(): Promise<string> {
      return `${adapterOptions.id}-run`;
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

function unavailableStatus(id: string, label: string, error = "missing"): AgentStatus {
  return {
    id,
    label,
    available: false,
    command: `${id}.cmd`,
    error
  };
}
