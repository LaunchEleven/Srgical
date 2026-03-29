import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStudioHeaderContent,
  formatPlanningPackSummary,
  formatTrackerSummary,
  renderWorkspaceSelectionMessage,
  resolveStudioWorkspaceInput
} from "../../src/ui/studio";
import type { PlanningPackState } from "../../src/core/planning-pack-state";

test("format-planning-pack-summary makes an unwritten plan obvious", () => {
  const workspace = "G:\\code\\Launch11Projects\\demo";
  const state = createPackState({
    packPresent: false,
    trackerReadable: false,
    mode: "No Pack"
  });

  assert.match(formatPlanningPackSummary(workspace, state), /state: no pack/);
  assert.match(formatPlanningPackSummary(workspace, state), /next: \/plan new <id> to create the planning doc set/);
  assert.match(renderWorkspaceSelectionMessage(workspace, state), /plan status: no pack/);
  assert.match(buildStudioHeaderContent(workspace, state), /PLAN DEFAULT \| NO PACK/);
});

test("format-planning-pack-summary makes a written plan obvious", () => {
  const workspace = "G:\\code\\Launch11Projects\\demo";
  const state = createPackState({
    packPresent: true,
    trackerReadable: true,
    nextRecommended: "EXEC001",
    mode: "Execution Active"
  });

  assert.match(formatPlanningPackSummary(workspace, state), /state: execution active/);
  assert.match(formatPlanningPackSummary(workspace, state), /next: \/preview, \/run, or \/auto when ready/);
  assert.match(buildStudioHeaderContent(workspace, state), /PLAN DEFAULT \| EXECUTION ACTIVE/);
});

test("format-tracker-summary shows none queued instead of unknown", () => {
  assert.equal(
    formatTrackerSummary({
      lastCompleted: "DOC002",
      nextRecommended: null,
      updatedAt: "2026-03-25T00:00:00.000Z"
    }),
    "last: DOC002\nnext: none queued\nupdated: 2026-03-25T00:00:00.000Z"
  );
});

test("resolve-studio-workspace-input resolves relative paths from the current workspace", () => {
  assert.equal(
    resolveStudioWorkspaceInput("G:\\code\\Launch11Projects\\srgical", "..\\another-repo"),
    "G:\\code\\Launch11Projects\\another-repo"
  );
  assert.equal(
    resolveStudioWorkspaceInput("G:\\code\\Launch11Projects\\srgical", "D:\\sandbox\\fresh"),
    "D:\\sandbox\\fresh"
  );
});

function createPackState(options: {
  packPresent: boolean;
  trackerReadable: boolean;
  nextRecommended?: string | null;
  mode?: PlanningPackState["mode"];
}): PlanningPackState {
  return {
    planId: "default",
    packDir: ".srgical",
    packPresent: options.packPresent,
    trackerReadable: options.trackerReadable,
    docsPresent: options.packPresent ? 5 : 0,
    currentPosition: {
      lastCompleted: options.packPresent ? "DOC002" : null,
      nextRecommended: options.nextRecommended ?? null,
      updatedAt: "2026-03-25T00:00:00.000Z"
    },
    nextStepSummary: options.nextRecommended
      ? {
          id: options.nextRecommended,
          status: "pending",
          dependsOn: "DOC002",
          scope: "Ship the next slice.",
          acceptance: "It lands cleanly.",
          notes: "",
          phase: "Phase 6"
        }
      : null,
    lastExecution: null,
    planningState: null,
    packMode: options.packPresent ? "authored" : "scaffolded",
    readiness: {
      checks: [],
      score: options.packPresent ? 3 : 0,
      total: 4,
      readyToWrite: false,
      missingLabels: []
    },
    humanWriteConfirmed: false,
    humanWriteConfirmedAt: null,
    autoRun: null,
    executionActivated: Boolean(options.nextRecommended),
    mode: options.mode ?? (options.packPresent ? "Plan Written - Needs Step" : "No Pack"),
    hasFailureOverlay: false
  };
}
