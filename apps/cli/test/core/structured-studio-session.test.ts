import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentSessionStore, deriveRepositoryId } from "@srgical/agent-runtime";
import { createStudioController } from "../../../../packages/studio-core/src/controller";
import type { AgentAdapter } from "../../src/core/agent";
import { createTempWorkspace } from "../helpers/workspace";

test("studio reopens the same structured session and replays its event history", async (t) => {
  const workspace = await createTempWorkspace("srgical-structured-studio-");
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "srgical-structured-home-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const store = new AgentSessionStore({ homeDir });
  const adapter = createStreamingTestAdapter();
  const status = await adapter.detectStatus();
  const resolveAgent = async () => ({ adapter, status, statuses: [status] });
  const requestPlanner = adapter.requestPlannerReply.bind(adapter);
  const refreshAdvice = async () => undefined;
  const unavailableNativeProvider = {
    id: "anthropic-agent-sdk",
    label: "Claude Agent SDK",
    async detect() {
      return { providerId: this.id, label: this.label, available: true, authenticated: false, capabilities: [] };
    },
    async start(): Promise<never> {
      throw new Error("not available in this test");
    }
  };

  const first = await createStudioController({
    workspace,
    planId: "native-studio",
    laneId: "current",
    agentSessionStore: store,
    resolveAgent,
    requestPlanner,
    refreshAdvice,
    agentProvider: unavailableNativeProvider
  });
  const sessionId = first.getSnapshot().agentSession.sessionId;
  await first.submitInput("Build the session kernel");
  await first.dispatch({ type: "session-rename", title: "Kernel conversation" });
  assert.equal(first.getSnapshot().agentSession.title, "Kernel conversation");
  await first.dispatch({ type: "session-create", title: "Second conversation" });
  assert.equal(first.getSnapshot().agentSessions.length, 2);
  assert.equal(first.getSnapshot().agentSession.title, "Second conversation");
  await first.dispatch({ type: "session-switch", sessionId });
  await first.close();

  const reopened = await createStudioController({
    workspace,
    planId: "native-studio",
    laneId: "current",
    agentSessionStore: store,
    resolveAgent,
    requestPlanner,
    refreshAdvice,
    agentProvider: unavailableNativeProvider
  });
  assert.equal(reopened.getSnapshot().agentSession.sessionId, sessionId);
  assert.equal(reopened.getSnapshot().recentAgentEvents.length, 8);
  const events = await store.readEvents(deriveRepositoryId(workspace), sessionId);
  assert.deepEqual(events.map((event) => event.kind), [
    "message.started",
    "message.completed",
    "session.status",
    "message.started",
    "message.delta",
    "message.delta",
    "message.completed",
    "session.status"
  ]);
  assert.equal(events[1]?.kind === "message.completed" ? events[1].payload.text : null, "Build the session kernel");
  assert.equal(events[6]?.kind === "message.completed" ? events[6].payload.text : null, "Structured reply");
  await reopened.close();
});

function createStreamingTestAdapter(): AgentAdapter {
  return {
    id: "test",
    label: "Test Agent",
    async detectStatus() {
      return {
        id: "test",
        label: "Test Agent",
        available: true,
        command: "test-agent",
        version: "1.0.0"
      };
    },
    async requestPlannerReply(_workspaceRoot, _messages, options) {
      options?.onOutputChunk?.("Structured ");
      options?.onOutputChunk?.("reply");
      return "Structured reply";
    },
    async requestPlanningAdvice() {
      return "{}";
    },
    async refreshContextDocument() {
      return "context";
    },
    async dicePlanningPack() {
      return "diced";
    },
    async writePlanningPack() {
      return "written";
    },
    async runNextPrompt() {
      return "ran";
    }
  };
}
