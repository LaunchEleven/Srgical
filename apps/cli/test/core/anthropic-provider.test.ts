import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicAgentProvider, detectSupportedAuthentication } from "@srgical/agent-runtime";
import type { AgentEventDraft, AgentSessionRecord } from "@srgical/studio-shared";
import type {
  Options as AnthropicOptions,
  PermissionResult,
  Query,
  SDKMessage
} from "@anthropic-ai/claude-agent-sdk";

type QueryLike = AsyncIterable<SDKMessage> & Pick<Query, "interrupt" | "setPermissionMode" | "rewindFiles">;

test("Anthropic provider maps SDK stream, task, usage, and terminal events", async () => {
  const emitted: AgentEventDraft[] = [];
  const provider = new AnthropicAgentProvider({
    env: { ANTHROPIC_API_KEY: "test-key" },
    query: () => fakeQuery([
      sdk({ type: "system", subtype: "init", session_id: "claude-session", model: "claude-test" }),
      sdk({ type: "stream_event", session_id: "claude-session", uuid: "message-1", event: { type: "message_start" } }),
      sdk({
        type: "stream_event",
        session_id: "claude-session",
        uuid: "message-1",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } }
      }),
      sdk({ type: "stream_event", session_id: "claude-session", uuid: "message-1", event: { type: "message_stop" } }),
      sdk({
        type: "tool_progress",
        session_id: "claude-session",
        uuid: "progress-1",
        tool_use_id: "tool-1",
        tool_name: "Bash",
        parent_tool_use_id: null,
        elapsed_time_seconds: 2
      }),
      sdk({
        type: "system",
        subtype: "task_started",
        session_id: "claude-session",
        uuid: "task-message-1",
        task_id: "task-1",
        description: "Run tests"
      }),
      sdk({
        type: "result",
        subtype: "success",
        session_id: "claude-session",
        uuid: "result-1",
        total_cost_usd: 0.04,
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 3 },
        result: "Done"
      })
    ])
  });

  const status = await provider.detect();
  assert.equal(status.available, true);
  assert.equal(status.authenticated, true);

  const handle = await provider.start(startOptions(emitted));
  await handle.completion;

  assert.equal(handle.providerSessionId, "claude-session");
  assert.deepEqual(emitted.map((event) => event.kind), [
    "session.status",
    "session.started",
    "message.started",
    "message.delta",
    "message.completed",
    "tool.progress",
    "task.started",
    "usage.updated",
    "session.completed"
  ]);
  assert.deepEqual(emitted.find((event) => event.kind === "message.completed")?.payload, {
    messageId: "message-1",
    text: "Hello"
  });
});

test("Anthropic provider parks and resolves native permission requests", async () => {
  const emitted: AgentEventDraft[] = [];
  let permissionResult: PermissionResult | undefined;
  const provider = new AnthropicAgentProvider({
    query: ({ options }) => fakeInteractiveQuery(async () => {
      permissionResult = await options?.canUseTool?.("Bash", { command: "npm test" }, {
        signal: new AbortController().signal,
        toolUseID: "tool-1",
        requestId: "permission-1"
      });
    })
  });
  const handle = await provider.start(startOptions(emitted));

  await waitForEvent(emitted, "permission.requested");
  await handle.resolvePermission?.("permission-1", { behavior: "allow", updatedInput: { command: "npm test" } });
  await handle.completion;

  assert.equal(permissionResult?.behavior, "allow");
  assert.ok(emitted.some((event) => event.kind === "permission.resolved"));
});

test("Anthropic provider exposes AskUserQuestion through structured question events", async () => {
  const emitted: AgentEventDraft[] = [];
  let questionResult: PermissionResult | undefined;
  const provider = new AnthropicAgentProvider({
    query: ({ options }) => fakeInteractiveQuery(async () => {
      questionResult = await options?.canUseTool?.("AskUserQuestion", {
        questions: [{
          question: "Which approach?",
          header: "Approach",
          multiSelect: false,
          options: [{ label: "Native", description: "Use the SDK", preview: "<b>Native</b>" }]
        }]
      }, {
        signal: new AbortController().signal,
        toolUseID: "question-tool-1",
        requestId: "question-1"
      });
    })
  });
  const handle = await provider.start(startOptions(emitted));

  await waitForEvent(emitted, "question.requested");
  await handle.resolveQuestion?.("question-1", { answers: { "Which approach?": "Native" } });
  await handle.completion;

  assert.equal(questionResult?.behavior, "allow");
  if (questionResult?.behavior === "allow") {
    assert.deepEqual(questionResult.updatedInput?.answers, { "Which approach?": "Native" });
  }
  assert.ok(emitted.some((event) => event.kind === "question.resolved"));
});

test("supported authentication detection explicitly excludes implicit subscription OAuth", () => {
  assert.deepEqual(detectSupportedAuthentication({}), {
    authenticated: false,
    detail: "Configure a Claude Console API key or supported cloud provider. Srgical does not reuse Claude subscription OAuth."
  });
  assert.equal(detectSupportedAuthentication({ CLAUDE_CODE_USE_VERTEX: "true" }).authenticated, true);
  assert.equal(detectSupportedAuthentication({ CLAUDE_CODE_USE_BEDROCK: "1" }).authenticated, true);
});

test("Anthropic provider discovers account models and applies a conversation model", async () => {
  let captured: AnthropicOptions | undefined;
  const provider = new AnthropicAgentProvider({
    query: ({ options }) => {
      captured = options;
      return {
        ...fakeQuery([]),
        supportedModels: async () => [{
          value: "sonnet",
          resolvedModel: "claude-sonnet-test",
          displayName: "Claude Sonnet",
          description: "Balanced"
        }]
      };
    }
  });

  const catalog = await provider.listModels({ workspace: process.cwd() });
  assert.deepEqual(catalog.models.map((model) => model.id), ["sonnet"]);

  const options = startOptions([]);
  options.session.model = "sonnet";
  const handle = await provider.start(options);
  await handle.completion;
  assert.equal(captured?.model, "sonnet");
});

test("Anthropic provider projects MCP configuration and normalizes live status", async () => {
  let captured: AnthropicOptions | undefined;
  const provider = new AnthropicAgentProvider({
    query: ({ options }) => {
      captured = options;
      return {
        ...fakeQuery([]),
        mcpServerStatus: async () => [{
          name: "linear",
          status: "connected" as const,
          serverInfo: { name: "Linear MCP", version: "1.0.0" },
          tools: [{ name: "list_issues", annotations: { readOnly: true } }]
        }],
        reconnectMcpServer: async () => undefined
      };
    }
  });

  const handle = await provider.start({
    ...startOptions([]),
    mcpServers: {
      linear: { transport: "http", url: "https://mcp.linear.app/mcp" },
      local: { transport: "stdio", command: "node", args: ["server.js"] }
    }
  });
  await handle.completion;

  assert.deepEqual(captured?.mcpServers?.linear, {
    type: "http",
    url: "https://mcp.linear.app/mcp",
    headers: undefined,
    timeout: undefined,
    alwaysLoad: undefined
  });
  assert.equal((captured?.mcpServers?.local as { command?: string }).command, "node");
  assert.deepEqual(await handle.getMcpStatus?.(), [{
    connectorId: "linear",
    status: "connected",
    statusDetail: "Linear MCP 1.0.0",
    tools: [{ name: "list_issues", description: undefined, readOnly: true, destructive: undefined, openWorld: undefined }]
  }]);
});

function startOptions(emitted: AgentEventDraft[]) {
  return {
    session: sessionRecord(),
    prompt: "Implement the feature",
    signal: new AbortController().signal,
    emit: async (event: AgentEventDraft) => {
      emitted.push(event);
    }
  };
}

function sessionRecord(): AgentSessionRecord {
  return {
    version: 1,
    sessionId: "srgical-session",
    providerId: "anthropic-agent-sdk",
    providerSessionId: null,
    repoId: "repo-1",
    laneId: "current",
    workspace: process.cwd(),
    planId: null,
    title: "Test session",
    model: null,
    permissionMode: "default",
    status: "idle",
    lifecycle: "active",
    parentSessionId: null,
    pinnedAt: null,
    archivedAt: null,
    deletedAt: null,
    lastMessagePreview: null,
    workspaceBindings: [{
      bindingId: "binding-1",
      laneId: "current",
      workspace: process.cwd(),
      branchName: "main",
      startingCommit: null,
      endingCommit: null,
      attachedAt: "2026-07-19T00:00:00.000Z",
      retiredAt: null,
      retirementReason: null
    }],
    capabilities: [],
    effectiveSkillHashes: [],
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    lastEventSequence: 0
  };
}

function fakeQuery(messages: SDKMessage[]): QueryLike {
  return queryFrom(async function* () {
    yield* messages;
  });
}

function fakeInteractiveQuery(run: () => Promise<void>): QueryLike {
  return queryFrom(async function* () {
    yield sdk({ type: "system", subtype: "init", session_id: "claude-session", model: "claude-test" });
    await run();
    yield sdk({
      type: "result",
      subtype: "success",
      session_id: "claude-session",
      uuid: "result-1",
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      result: "Done"
    });
  });
}

function queryFrom(generator: () => AsyncGenerator<SDKMessage>): QueryLike {
  return {
    [Symbol.asyncIterator]: generator,
    interrupt: async () => undefined,
    setPermissionMode: async () => undefined,
    rewindFiles: async () => ({ canRewind: true, filesChanged: ["src/index.ts"] })
  };
}

function sdk(value: Record<string, unknown>): SDKMessage {
  return value as unknown as SDKMessage;
}

async function waitForEvent(events: AgentEventDraft[], kind: AgentEventDraft["kind"]): Promise<void> {
  const timeoutAt = Date.now() + 2_000;
  while (!events.some((event) => event.kind === kind)) {
    if (Date.now() > timeoutAt) throw new Error(`Timed out waiting for ${kind}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
