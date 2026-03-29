import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { preparePlanningPackForWrite } from "../../src/core/planning-epochs";
import { readText, writeText } from "../../src/core/workspace";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("preparePlanningPackForWrite archives the active pack when no next step is queued", async () => {
  const workspace = await createTempWorkspace("srgical-planning-epoch-");
  const paths = await writePlanningPack(workspace);

  await writeText(paths.plan, "# Old Plan\n");
  await writeText(paths.context, "# Old Context\n");
  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`DIST001\`
- Next Recommended: none queued
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`
`
  );
  await writeText(paths.nextPrompt, "# Old Prompt\n");
  await writeText(paths.executionLog, "# Execution Log\n");

  const result = await preparePlanningPackForWrite(workspace);
  const archiveDir = path.join(workspace, ".srgical", "plans", "default", "planning-1");

  assert.equal(result.archived, true);
  assert.equal(result.archiveDir, ".srgical/plans/default/planning-1");
  assert.match(await readText(path.join(archiveDir, "01-product-plan.md")), /# Old Plan/);
  assert.match(await readText(path.join(archiveDir, "02-agent-context-kickoff.md")), /# Old Context/);
  assert.match(await readText(path.join(archiveDir, "04-next-agent-prompt.md")), /# Old Prompt/);
  assert.match(await readText(path.join(archiveDir, "execution-log.md")), /# Execution Log/);

  const activeTracker = await readText(paths.tracker);
  assert.match(activeTracker, /- Last Completed: `BOOT-001`/);
  assert.match(activeTracker, /- Next Recommended: `PLAN-001`/);
});

test("preparePlanningPackForWrite keeps the active pack in place when execution is still queued", async () => {
  const workspace = await createTempWorkspace("srgical-planning-epoch-active-");
  const paths = await writePlanningPack(workspace);

  await writeText(paths.plan, "# Active Plan\n");
  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`PACK002\`
- Next Recommended: \`EXEC001\`
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`
`
  );

  const result = await preparePlanningPackForWrite(workspace);

  assert.equal(result.archived, false);
  assert.equal(result.archiveDir, null);
  assert.equal(await readText(paths.plan), "# Active Plan\n");
});
