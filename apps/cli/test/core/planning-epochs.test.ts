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
    `# Tracker

## Current Position

- Last completed: \`DISCOVER-001\`
- Next step: none queued
- Updated at: \`2026-03-24T00:00:00.000Z\`
- Updated by: \`srgical\`
`
  );
  await writeText(paths.changes, "# Old Changes\n");
  await writeText(paths.manifest, "{\n  \"version\": 1\n}\n");
  await writeText(paths.executionLog, "# Execution Log\n");

  const result = await preparePlanningPackForWrite(workspace);
  const archiveDir = path.join(workspace, ".srgical", "plans", "default", "revision-1");

  assert.equal(result.archived, true);
  assert.equal(result.archiveDir, ".srgical/plans/default/revision-1");
  assert.match(await readText(path.join(archiveDir, "plan.md")), /# Old Plan/);
  assert.match(await readText(path.join(archiveDir, "context.md")), /# Old Context/);
  assert.match(await readText(path.join(archiveDir, "changes.md")), /# Old Changes/);
  assert.match(await readText(path.join(archiveDir, "manifest.json")), /"version": 1/);
  assert.match(await readText(path.join(archiveDir, "execution-log.md")), /# Execution Log/);

  const activeTracker = await readText(paths.tracker);
  assert.match(activeTracker, /- Last completed: `BOOT-001`/);
  assert.match(activeTracker, /- Next step: `DISCOVER-001`/);
});

test("preparePlanningPackForWrite keeps the active pack in place when execution is still queued", async () => {
  const workspace = await createTempWorkspace("srgical-planning-epoch-active-");
  const paths = await writePlanningPack(workspace);

  await writeText(paths.plan, "# Active Plan\n");
  await writeText(
    paths.tracker,
    `# Tracker

## Current Position

- Last completed: \`DISCOVER-001\`
- Next step: \`BUILD-001\`
- Updated at: \`2026-03-24T00:00:00.000Z\`
- Updated by: \`srgical\`
`
  );

  const result = await preparePlanningPackForWrite(workspace);

  assert.equal(result.archived, false);
  assert.equal(result.archiveDir, null);
  assert.equal(await readText(paths.plan), "# Active Plan\n");
});
