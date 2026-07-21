import assert from "node:assert/strict";
import test from "node:test";
import { completeTurnHooks, prepareTurnHooks } from "@srgical/studio-core";
import type { AgentEventDraft, ConnectorRegistrySnapshot, HookDefinition, SkillRecord, SkillRegistrySnapshot } from "@srgical/studio-shared";

test("turn hooks produce skill directives and durable lifecycle events", async () => {
  const events: AgentEventDraft[] = [];
  const hook = createHook({ handler: { type: "skill", skillId: "policy" } });
  const prepared = await prepareTurnHooks({
    hooks: [hook],
    trigger: "turn.received",
    userMessage: "Change the authentication flow",
    skills: createSkills(),
    connectors: createConnectors(),
    mcpAvailable: true,
    emit: async (event) => { events.push(event); }
  });
  assert.equal(prepared.length, 1);
  assert.match(prepared[0]?.promptBlock ?? "", /SKILL\.md/);
  assert.match(prepared[0]?.promptBlock ?? "", /Change the authentication flow/);
  await completeTurnHooks(prepared, async (event) => { events.push(event); });
  assert.deepEqual(events.map((event) => event.kind), ["hook.started", "hook.completed"]);
});

test("MCP hooks validate connector tools and blocking failures stop preparation", async () => {
  const events: AgentEventDraft[] = [];
  const hook = createHook({
    handler: { type: "mcp", connectorId: "graph", toolName: "query_graph" },
    blocking: true
  });
  const prepared = await prepareTurnHooks({
    hooks: [hook],
    trigger: "turn.received",
    userMessage: "Find related decisions",
    skills: createSkills(),
    connectors: createConnectors(),
    mcpAvailable: true,
    emit: async (event) => { events.push(event); }
  });
  assert.match(prepared[0]?.promptBlock ?? "", /connector `Graph` and call tool `query_graph`/);
  await completeTurnHooks(prepared, async (event) => { events.push(event); }, { observedToolNames: [] });
  assert.equal(events.at(-1)?.kind, "hook.failed");

  const completedEvents: AgentEventDraft[] = [];
  await completeTurnHooks(prepared, async (event) => { completedEvents.push(event); }, { observedToolNames: ["mcp__graph__query_graph"] });
  assert.equal(completedEvents.at(-1)?.kind, "hook.completed");

  await assert.rejects(prepareTurnHooks({
    hooks: [hook],
    trigger: "turn.received",
    userMessage: "Find related decisions",
    skills: createSkills(),
    connectors: createConnectors(),
    mcpAvailable: false,
    emit: async () => undefined
  }), /Blocking hook/);
});

function createHook(overrides: Partial<HookDefinition>): HookDefinition {
  return {
    hookId: "policy-hook",
    label: "Policy hook",
    description: "Apply policy context.",
    trigger: "turn.received",
    handler: { type: "skill", skillId: "policy" },
    instruction: "Check policy before responding.",
    enabled: true,
    blocking: false,
    priority: 100,
    timeoutMs: 15_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function createSkills(): SkillRegistrySnapshot {
  const skill: SkillRecord = {
    id: "policy",
    name: "Repository Policy",
    description: "Check repository policy.",
    scope: "project",
    source: "/skills/policy",
    rootPath: "/skills/policy",
    manifestPath: "/skills/policy/SKILL.md",
    supportingFiles: [],
    hash: "hash",
    trust: "trusted",
    enabled: true,
    effective: true,
    shadowedBy: null,
    compatibleProviders: [],
    warnings: []
  };
  return { globalSkillsDirectory: "/skills", discoveredDirectories: [], configuredDirectories: [], skills: [skill], effectiveSkillHashes: ["hash"], promptActions: [], conflicts: [] };
}

function createConnectors(): ConnectorRegistrySnapshot {
  return {
    configPath: "/config/connectors.json",
    catalog: [],
    enabledCount: 1,
    readyCount: 1,
    connectors: [{
      connectorId: "graph",
      label: "Graph",
      description: "Knowledge graph",
      presetId: null,
      enabled: true,
      definition: { transport: "http", url: "https://graph.example/mcp" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      missingEnvironmentVariables: [],
      status: "ready",
      statusDetail: null,
      tools: [{ name: "query_graph", readOnly: true }]
    }]
  };
}
