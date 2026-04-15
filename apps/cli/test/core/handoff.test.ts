import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { buildExecutionIterationPrompt } from "../../src/core/handoff";
import { readPlanningPackState } from "../../src/core/planning-pack-state";
import { saveStudioOperateConfig } from "../../src/core/studio-operate-config";
import { writeText } from "../../src/core/workspace";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("build-execution-iteration-prompt appends configured operate guidance references", async () => {
  const workspace = await createTempWorkspace("srgical-handoff-guidance-");
  const paths = await writePlanningPack(workspace, { planId: "release-readiness" });

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
| EXEC-001 | pending | PLAN-001 | Ship one step. | Step is complete. | Pending. |
`
  );

  const docsDir = path.join(workspace, "docs");
  await mkdir(docsDir, { recursive: true });
  await writeText(path.join(docsDir, "operate-guidelines.md"), "Always update validation notes in the tracker.");
  await saveStudioOperateConfig(
    workspace,
    {
      referencePaths: ["docs/operate-guidelines.md"]
    },
    { planId: "release-readiness" }
  );

  const packState = await readPlanningPackState(workspace, { planId: "release-readiness" });
  const prompt = await buildExecutionIterationPrompt(workspace, packState, { planId: "release-readiness" });

  assert.match(prompt.prompt, /Operate guidance references/);
  assert.match(prompt.prompt, /docs\/operate-guidelines\.md/);
  assert.match(prompt.prompt, /Always update validation notes in the tracker\./);
});
