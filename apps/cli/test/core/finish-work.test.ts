import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSessionRecord } from "@srgical/studio-shared";
import { assessFinishWork } from "../../src/core/finish-work";
import type { WorktreeLaneSummary } from "../../src/core/worktree-lanes";

test("Finish Work separates session archival readiness from destructive worktree removal", () => {
  const clean = assessFinishWork(lane(), [session()]);
  assert.equal(clean.canArchive, true);
  assert.equal(clean.canRemoveWorktree, true);
  assert.equal(clean.sessionCount, 1);
  assert.match(clean.preserved.join(" "), /durable session transcript/);

  const dirty = assessFinishWork(lane({ unstagedCount: 2, dirty: true, lifecycle: "working" }), [session()]);
  assert.equal(dirty.canArchive, true);
  assert.equal(dirty.canRemoveWorktree, false);
  assert.match(dirty.removalBlockers.join(" "), /uncommitted/);
});

test("Finish Work blocks archival while an operation is active and protects current checkout", () => {
  const assessment = assessFinishWork(lane({ isCurrentCheckout: true, canRemove: false }), [session()], { activeOperation: true });
  assert.equal(assessment.canArchive, false);
  assert.equal(assessment.canRemoveWorktree, false);
  assert.match(assessment.blockers.join(" "), /still running/);
  assert.match(assessment.removalBlockers.join(" "), /primary checkout/);
});

function lane(overrides: Partial<WorktreeLaneSummary> = {}): WorktreeLaneSummary {
  return {
    laneId: "feature",
    planId: "feature",
    branchName: "srgical/feature",
    worktreePath: "C:\\repo-feature",
    workspaceLabel: "repo-feature",
    dirty: false,
    archived: false,
    removed: false,
    isCurrentCheckout: false,
    canRemove: true,
    deleteLocked: false,
    lastMode: "operate",
    createdAt: "2026-07-19T00:00:00.000Z",
    openedAt: "2026-07-19T00:00:00.000Z",
    unlockedAt: "2026-07-19T00:00:00.000Z",
    source: "managed",
    head: "def456",
    lifecycle: "ready",
    baseRef: "main",
    mergeBase: "abc123",
    aheadCount: 1,
    behindCount: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    gitLocked: false,
    prunable: false,
    nextAction: "Review and integrate 1 local commit.",
    ...overrides
  };
}

function session(): AgentSessionRecord {
  return {
    version: 1,
    sessionId: "session-1",
    providerId: "anthropic-agent-sdk",
    providerSessionId: "claude-1",
    repoId: "repo-1",
    laneId: "feature",
    workspace: "C:\\repo-feature",
    planId: "feature",
    title: "Feature",
    model: null,
    permissionMode: "default",
    status: "completed",
    lifecycle: "active",
    parentSessionId: null,
    pinnedAt: null,
    archivedAt: null,
    deletedAt: null,
    lastMessagePreview: "Finished the feature",
    workspaceBindings: [{
      bindingId: "binding-1",
      laneId: "feature",
      workspace: "C:\\repo-feature",
      branchName: "srgical/feature",
      startingCommit: "abc123",
      endingCommit: null,
      attachedAt: "2026-07-19T00:00:00.000Z",
      retiredAt: null,
      retirementReason: null
    }],
    capabilities: ["sessions"],
    effectiveSkillHashes: [],
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T01:00:00.000Z",
    lastEventSequence: 2
  };
}
