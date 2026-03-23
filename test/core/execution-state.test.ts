import test from "node:test";
import assert from "node:assert/strict";
import { appendExecutionLog, loadExecutionState, saveExecutionState } from "../../src/core/execution-state";
import { getPlanningPackPaths, readText } from "../../src/core/workspace";
import { createTempWorkspace } from "../helpers/workspace";

test("saveExecutionState and loadExecutionState round-trip normalized output", async () => {
  const workspace = await createTempWorkspace("srgical-execution-state-");
  const noisySummary = "line one\nline two\n\nline three";

  await saveExecutionState(workspace, "success", "run-next", noisySummary);
  const state = await loadExecutionState(workspace);

  assert.ok(state);
  assert.equal(state.status, "success");
  assert.equal(state.source, "run-next");
  assert.equal(state.summary, "line one line two line three");
});

test("appendExecutionLog creates a durable markdown log with the step label", async () => {
  const workspace = await createTempWorkspace("srgical-execution-log-");
  const paths = getPlanningPackPaths(workspace);

  await appendExecutionLog(workspace, "failure", "studio", "Planner failed after validation.", {
    stepLabel: "`TEST001`"
  });

  const log = await readText(paths.executionLog);

  assert.match(log, /# Execution Log/);
  assert.match(log, /## .* - studio - failure/);
  assert.match(log, /- Step: `TEST001`/);
  assert.match(log, /- Summary: Planner failed after validation\./);
});
