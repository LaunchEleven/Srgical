import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentSessionStore, runLegacyTextTurn } from "@srgical/agent-runtime";
import type { AgentEventDraft } from "@srgical/studio-shared";

test("agent session store persists ordered events and projects lifecycle state", async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "srgical-agent-store-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  let clock = 0;
  let id = 0;
  const store = new AgentSessionStore({
    homeDir,
    now: () => `2026-07-19T00:00:${String(clock++).padStart(2, "0")}.000Z`,
    createId: () => `id-${++id}`
  });
  const created = await store.create({
    sessionId: "session-1",
    providerId: "legacy-claude",
    repoId: "repo-1",
    laneId: "feature-auth",
    workspace: homeDir,
    planId: "auth",
    title: "Implement auth",
    model: null,
    permissionMode: "plan",
    capabilities: ["streaming", "streaming"],
    effectiveSkillHashes: []
  });

  assert.equal(created.lastEventSequence, 0);
  const delivered: number[] = [];
  const unsubscribe = store.subscribe("session-1", (event) => delivered.push(event.sequence));
  await Promise.all([
    store.append("repo-1", "session-1", {
      kind: "session.started",
      payload: { providerSessionId: "provider-1", model: "test-model" }
    }),
    store.append("repo-1", "session-1", {
      kind: "session.status",
      payload: { status: "waiting", detail: "permission" }
    })
  ]);

  const events = await store.readEvents("repo-1", "session-1");
  assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
  const loaded = await store.load("repo-1", "session-1");
  assert.equal(loaded?.providerSessionId, "provider-1");
  assert.equal(loaded?.model, "test-model");
  assert.equal(loaded?.status, "waiting");
  assert.equal(loaded?.lastEventSequence, 2);
  assert.deepEqual(delivered, [1, 2]);
  unsubscribe();
});

test("agent session recovery repairs a record after an appended event wins a crash race", async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "srgical-agent-recover-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const store = new AgentSessionStore({ homeDir, createId: () => "event-1" });
  await store.create({
    sessionId: "session-1",
    providerId: "test",
    repoId: "repo-1",
    laneId: "current",
    workspace: homeDir,
    planId: null,
    title: "Recovery",
    model: null,
    permissionMode: "default",
    capabilities: [],
    effectiveSkillHashes: []
  });
  const sessionDir = path.join(homeDir, ".srgical", "repos", "repo-1", "sessions", "session-1");
  const event = {
    version: 1,
    eventId: "crash-event",
    sequence: 1,
    timestamp: "2026-07-19T01:00:00.000Z",
    sessionId: "session-1",
    kind: "session.completed",
    payload: { result: "done" }
  };
  await writeFile(path.join(sessionDir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");

  const recovered = await store.recover("repo-1", "session-1");
  assert.equal(recovered.lastEventSequence, 1);
  assert.equal(recovered.status, "completed");
  const persisted = JSON.parse(await readFile(path.join(sessionDir, "session.json"), "utf8")) as { lastEventSequence: number };
  assert.equal(persisted.lastEventSequence, 1);
});

test("legacy bridge converts output chunks into structured message events", async () => {
  const drafts: AgentEventDraft[] = [];
  const result = await runLegacyTextTurn({
    createMessageId: () => "message-1",
    emit: async (event) => {
      drafts.push(event);
    },
    invoke: async ({ onOutputChunk }) => {
      onOutputChunk("hel");
      onOutputChunk("lo");
      return "hello";
    }
  });

  assert.equal(result, "hello");
  assert.deepEqual(drafts.map((event) => event.kind), [
    "session.status",
    "message.started",
    "message.delta",
    "message.delta",
    "message.completed",
    "session.status"
  ]);
});

test("agent sessions preserve lifecycle, fork ancestry, previews, and retired workspace bindings", async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "srgical-session-lifecycle-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  let id = 0;
  const store = new AgentSessionStore({ homeDir, createId: () => `lifecycle-${++id}` });
  const parent = await store.create({
    providerId: "anthropic-agent-sdk",
    repoId: "repo-1",
    laneId: "lane-1",
    workspace: homeDir,
    planId: "sessions",
    title: "Parent",
    model: null,
    permissionMode: "default",
    capabilities: ["sessions", "fork"],
    effectiveSkillHashes: [],
    branchName: "srgical/sessions",
    startingCommit: "abc123"
  });
  const child = await store.create({
    providerId: "anthropic-agent-sdk",
    providerSessionId: "claude-parent",
    parentSessionId: parent.sessionId,
    repoId: "repo-1",
    laneId: "lane-1",
    workspace: homeDir,
    planId: "sessions",
    title: "Fork",
    model: null,
    permissionMode: "default",
    capabilities: ["sessions", "fork"],
    effectiveSkillHashes: []
  });
  await store.append("repo-1", child.sessionId, {
    kind: "message.completed",
    payload: { messageId: "message-1", text: "A searchable preview of the latest conversation" }
  });
  await store.setPinned("repo-1", child.sessionId, true);
  await store.retireWorkspace("repo-1", child.sessionId, { endingCommit: "def456", reason: "work-finished" });
  await store.setArchived("repo-1", child.sessionId, true);

  const loaded = await store.load("repo-1", child.sessionId);
  assert.equal(loaded?.parentSessionId, parent.sessionId);
  assert.equal(loaded?.lifecycle, "archived");
  assert.ok(loaded?.pinnedAt);
  assert.equal(loaded?.lastMessagePreview, "A searchable preview of the latest conversation");
  assert.equal(loaded?.workspaceBindings[0]?.endingCommit, "def456");
  assert.equal(loaded?.workspaceBindings[0]?.retirementReason, "work-finished");
});

test("legacy session records gain an active workspace binding when loaded", async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "srgical-session-migrate-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const store = new AgentSessionStore({ homeDir, createId: () => "binding-1" });
  const created = await store.create({
    sessionId: "legacy-session",
    providerId: "legacy-cli:claude",
    repoId: "repo-1",
    laneId: "current",
    workspace: homeDir,
    planId: null,
    title: "Legacy",
    model: null,
    permissionMode: "plan",
    capabilities: [],
    effectiveSkillHashes: []
  });
  const sessionFile = path.join(homeDir, ".srgical", "repos", "repo-1", "sessions", created.sessionId, "session.json");
  const legacy = JSON.parse(await readFile(sessionFile, "utf8")) as Record<string, unknown>;
  for (const key of ["lifecycle", "parentSessionId", "pinnedAt", "archivedAt", "deletedAt", "lastMessagePreview", "workspaceBindings"]) delete legacy[key];
  await writeFile(sessionFile, JSON.stringify(legacy, null, 2), "utf8");

  const migrated = await store.load("repo-1", created.sessionId);
  assert.equal(migrated?.lifecycle, "active");
  assert.equal(migrated?.workspaceBindings.length, 1);
  assert.equal(migrated?.workspaceBindings[0]?.bindingId, `legacy-${created.sessionId}`);
});
