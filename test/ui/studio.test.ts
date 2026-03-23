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
    trackerReadable: false
  });

  assert.match(formatPlanningPackSummary(workspace, state), /state: not written yet/);
  assert.match(formatPlanningPackSummary(workspace, state), /next: \/write will put the plan on disk/);
  assert.match(renderWorkspaceSelectionMessage(workspace, state), /plan status: not written yet/);
  assert.match(buildStudioHeaderContent(workspace, state), /PLAN NOT WRITTEN/);
});

test("format-planning-pack-summary makes a written plan obvious", () => {
  const workspace = "G:\\code\\Launch11Projects\\demo";
  const state = createPackState({
    packPresent: true,
    trackerReadable: true,
    nextRecommended: "EXEC001"
  });

  assert.match(formatPlanningPackSummary(workspace, state), /state: written to disk/);
  assert.match(formatPlanningPackSummary(workspace, state), /next: \/preview or \/run when ready/);
  assert.match(buildStudioHeaderContent(workspace, state), /PLAN WRITTEN/);
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
}): PlanningPackState {
  return {
    packPresent: options.packPresent,
    trackerReadable: options.trackerReadable,
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
    lastExecution: null
  };
}
