import test from "node:test";
import assert from "node:assert/strict";
import { unblockTrackerStep } from "../../src/core/tracker-unblock";
import { readText, writeText } from "../../src/core/workspace";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("unblock-tracker-step marks the blocked next step todo and records retry context", async () => {
  const workspace = await createTempWorkspace("srgical-unblock-success-");
  const paths = await writePlanningPack(workspace, { planId: "prototype" });

  await writeText(
    paths.tracker,
    `# Tracker

## Current Position

- Last completed: \`PLAN-001\`
- Next step: \`EXEC-001\`
- Updated at: \`2026-03-30T00:00:00.000Z\`
- Updated by: \`codex\`

## Delivery

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXEC-001 | build | blocked | PLAN-001 | Build and validate the first feature slice. | All checks pass. | npm test | npm install failed with EACCES. |
`
  );

  const result = await unblockTrackerStep(workspace, {
    planId: "prototype",
    reason: "registry access restored"
  });
  const tracker = await readText(paths.tracker);

  assert.equal(result.stepId, "EXEC-001");
  assert.equal(result.previousStatus, "blocked");
  assert.equal(result.nextRecommendedBefore, "EXEC-001");
  assert.equal(result.nextRecommendedAfter, "EXEC-001");
  assert.match(tracker, /\| EXEC-001 \| build \| todo \| PLAN-001 \| Build and validate the first feature slice\./);
  assert.match(tracker, /unblock retry requested \(.+\) - registry access restored/);
  assert.match(tracker, /- Next step: `EXEC-001`/);
  assert.match(tracker, /- Updated by: `srgical`/);
});

test("unblock-tracker-step rejects a target step that is not currently blocked", async () => {
  const workspace = await createTempWorkspace("srgical-unblock-not-blocked-");
  const paths = await writePlanningPack(workspace, { planId: "prototype" });

  await writeText(
    paths.tracker,
    `# Tracker

## Current Position

- Last completed: \`PLAN-001\`
- Next step: \`EXEC-001\`
- Updated at: \`2026-03-30T00:00:00.000Z\`
- Updated by: \`codex\`

## Delivery

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXEC-001 | build | todo | PLAN-001 | Build and validate the first feature slice. | All checks pass. | npm test | Ready to run. |
`
  );

  await assert.rejects(
    async () => {
      await unblockTrackerStep(workspace, { planId: "prototype" });
    },
    /is not blocked/
  );
});

test("unblock-tracker-step rejects when the target step cannot be found in tracker tables", async () => {
  const workspace = await createTempWorkspace("srgical-unblock-missing-step-");
  const paths = await writePlanningPack(workspace, { planId: "prototype" });

  await writeText(
    paths.tracker,
    `# Tracker

## Current Position

- Last completed: \`PLAN-001\`
- Next step: \`EXEC-999\`
- Updated at: \`2026-03-30T00:00:00.000Z\`
- Updated by: \`codex\`

## Delivery

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXEC-001 | build | blocked | PLAN-001 | Build and validate the first feature slice. | All checks pass. | npm test | waiting on env. |
`
  );

  await assert.rejects(
    async () => {
      await unblockTrackerStep(workspace, { planId: "prototype" });
    },
    /Could not find tracker row/
  );
});
