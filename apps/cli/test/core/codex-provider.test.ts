import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexAgentProvider,
  detectCodexAuthentication,
  mapCodexEvent,
  toCodexMcpConfiguration
} from "@srgical/agent-runtime";
import type { CodexOptions, ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import type { AgentEventDraft, AgentSessionRecord } from "@srgical/studio-shared";

test("Codex provider resumes durable threads and maps streamed agent, tool, file, and usage events", async () => {
  const emitted: AgentEventDraft[] = [];
  let resumedId: string | null = null;
  let threadOptions: ThreadOptions | undefined;
  const provider = new CodexAgentProvider({
    env: { CODEX_API_KEY: "test-key" },
    createCodex: () => ({
      startThread() {
        throw new Error("expected resume");
      },
      resumeThread(id, options) {
        resumedId = id;
        threadOptions = options;
        return fakeThread("codex-thread", [
          event({ type: "thread.started", thread_id: "codex-thread" }),
          event({ type: "turn.started" }),
          event({ type: "item.started", item: { id: "shell-1", type: "command_execution", command: "npm test", aggregated_output: "", status: "in_progress" } }),
          event({ type: "item.completed", item: { id: "shell-1", type: "command_execution", command: "npm test", aggregated_output: "ok", exit_code: 0, status: "completed" } }),
          event({ type: "item.completed", item: { id: "patch-1", type: "file_change", changes: [{ path: "src/index.ts", kind: "update" }], status: "completed" } }),
          event({ type: "item.completed", item: { id: "message-1", type: "agent_message", text: "Implemented" } }),
          event({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 6, reasoning_output_tokens: 1 } })
        ]);
      }
    })
  });

  const status = await provider.detect();
  assert.equal(status.authenticated, true);
  const handle = await provider.start({
    session: sessionRecord("plan"),
    prompt: "Inspect only",
    resumeProviderSessionId: "existing-thread",
    signal: new AbortController().signal,
    emit: async (draft) => { emitted.push(draft); }
  });
  await handle.completion;

  assert.equal(resumedId, "existing-thread");
  assert.equal(threadOptions?.sandboxMode, "read-only");
  assert.equal(threadOptions?.approvalPolicy, "on-request");
  assert.equal(handle.providerSessionId, "codex-thread");
  assert.deepEqual(emitted.map((draft) => draft.kind), [
    "session.status",
    "session.started",
    "session.status",
    "tool.started",
    "tool.completed",
    "tool.completed",
    "files.changed",
    "message.started",
    "message.delta",
    "message.completed",
    "usage.updated",
    "session.completed"
  ]);
});

test("Codex MCP projection keeps resolved HTTP secrets out of CLI config", () => {
  const projected = toCodexMcpConfiguration({
    linear: {
      transport: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: "Bearer secret-token", "X-Tenant": "tenant-secret" },
      oauth: { callbackPort: 3118 },
      timeoutMs: 4_500
    },
    local: {
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: { LOCAL_MODE: "local-secret" }
    }
  }, { PATH: "test-path" });

  const serialized = JSON.stringify(projected.config);
  assert.doesNotMatch(serialized, /secret-token|tenant-secret|local-secret/);
  assert.equal(projected.config.mcp_oauth_callback_port, 3118);
  assert.equal((projected.config.mcp_servers as Record<string, Record<string, unknown>>).linear.url, "https://mcp.linear.app/mcp");
  assert.ok(Object.values(projected.env).includes("secret-token"));
  assert.ok(Object.values(projected.env).includes("tenant-secret"));
  assert.equal(projected.env.LOCAL_MODE, "local-secret");
  assert.equal((projected.config.mcp_servers as Record<string, Record<string, unknown>>).local.command, "node");
});

test("Codex authentication recognizes API keys and saved CLI login state", async () => {
  assert.equal((await detectCodexAuthentication({ CODEX_API_KEY: "key" }, "missing")).authenticated, true);
  assert.deepEqual(await detectCodexAuthentication({}, "definitely-missing-auth-file"), {
    authenticated: false,
    detail: "Run `codex login` or set CODEX_API_KEY."
  });
});

test("Codex MCP and failure events map to shared Studio events", () => {
  const started = mapCodexEvent(event({
    type: "item.started",
    item: { id: "mcp-1", type: "mcp_tool_call", server: "linear", tool: "list_issues", arguments: {}, status: "in_progress" }
  }));
  const failed = mapCodexEvent(event({ type: "turn.failed", error: { message: "model unavailable" } }));
  assert.equal(started[0]?.kind, "tool.started");
  assert.equal(started[0]?.kind === "tool.started" ? started[0].payload.toolName : null, "linear/list_issues");
  assert.deepEqual(failed[0]?.payload, { message: "model unavailable" });
});

function sessionRecord(permissionMode: AgentSessionRecord["permissionMode"]): AgentSessionRecord {
  return {
    version: 1,
    sessionId: "srgical-session",
    providerId: "codex-sdk",
    providerSessionId: null,
    repoId: "repo-1",
    laneId: "current",
    workspace: process.cwd(),
    planId: null,
    title: "Codex compatibility",
    model: null,
    permissionMode,
    status: "idle",
    lifecycle: "active",
    parentSessionId: null,
    pinnedAt: null,
    archivedAt: null,
    deletedAt: null,
    lastMessagePreview: null,
    workspaceBindings: [],
    capabilities: [],
    effectiveSkillHashes: [],
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    lastEventSequence: 0
  };
}

function fakeThread(id: string, events: ThreadEvent[]) {
  return {
    id,
    async runStreamed() {
      return {
        events: (async function* () {
          yield* events;
        })()
      };
    }
  };
}

function event(value: object): ThreadEvent {
  return value as ThreadEvent;
}
