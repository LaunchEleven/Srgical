import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getHookRegistryPath, loadHookRegistry, removeHook, setHookEnabled, upsertHook } from "../../src/core/hook-registry";

test("hook registry persists ordered skill and MCP lifecycle hooks", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "srgical-hooks-"));
  t.after(() => rm(home, { recursive: true, force: true }));

  await upsertHook("repo-hooks", {
    label: "Capture graph knowledge",
    trigger: "turn.completed",
    handler: { type: "mcp", connectorId: "graph", toolName: "upsert_nodes" },
    instruction: "Capture durable decisions with provenance.",
    priority: 200
  }, home);
  await upsertHook("repo-hooks", {
    label: "Apply policy",
    trigger: "turn.received",
    handler: { type: "skill", skillId: "policy" },
    instruction: "Check the request against repository policy.",
    priority: 20,
    blocking: true
  }, home);

  const loaded = await loadHookRegistry("repo-hooks", home);
  assert.deepEqual(loaded.hooks.map((hook) => hook.hookId), ["apply-policy", "capture-graph-knowledge"]);
  assert.equal(loaded.hooks[0]?.blocking, true);
  assert.match(getHookRegistryPath("repo-hooks", home), /hooks\.json$/);

  const disabled = await setHookEnabled("repo-hooks", "apply-policy", false, home);
  assert.equal(disabled.hooks.find((hook) => hook.hookId === "apply-policy")?.enabled, false);
  const removed = await removeHook("repo-hooks", "capture-graph-knowledge", home);
  assert.deepEqual(removed.hooks.map((hook) => hook.hookId), ["apply-policy"]);
});

test("hook registry validates incomplete handlers", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "srgical-hook-validation-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await assert.rejects(upsertHook("repo-hooks", {
    label: "Broken graph hook",
    trigger: "turn.received",
    handler: { type: "mcp", connectorId: "graph", toolName: "" },
    instruction: "Query context."
  }, home), /tool name/);
});
