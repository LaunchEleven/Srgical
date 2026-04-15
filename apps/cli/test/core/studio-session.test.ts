import test from "node:test";
import assert from "node:assert/strict";
import { ensurePlanningDir, readText, writeText } from "../../src/core/workspace";
import {
  loadStoredActiveAgentId,
  loadStudioSession,
  saveStoredActiveAgentId,
  saveStudioSession
} from "../../src/core/studio-session";
import { createTempWorkspace } from "../helpers/workspace";

test("save-studio-session preserves an existing active-agent selection", async () => {
  const workspace = await createTempWorkspace("srgical-studio-session-");
  const initialMessages = [{ role: "assistant" as const, content: "hello" }];
  const updatedMessages = [{ role: "user" as const, content: "switch it" }];

  await saveStudioSession(workspace, initialMessages);
  await saveStoredActiveAgentId(workspace, "claude");
  await saveStudioSession(workspace, updatedMessages);

  assert.deepEqual(await loadStudioSession(workspace), updatedMessages);
  assert.equal(await loadStoredActiveAgentId(workspace), "claude");
});

test("legacy studio-session payloads still load messages without an active-agent selection", async () => {
  const workspace = await createTempWorkspace("srgical-studio-session-legacy-");
  const paths = await ensurePlanningDir(workspace);

  await writeText(
    paths.studioSession,
    JSON.stringify(
      {
        version: 1,
        updatedAt: "2026-03-24T00:00:00.000Z",
        messages: [{ role: "assistant", content: "legacy hello" }]
      },
      null,
      2
    )
  );

  assert.deepEqual(await loadStudioSession(workspace), [{ role: "assistant", content: "legacy hello" }]);
  assert.equal(await loadStoredActiveAgentId(workspace), null);
  assert.match(await readText(paths.studioSession), /"version": 1/);
});
