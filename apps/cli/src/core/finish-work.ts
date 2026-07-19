import type { AgentSessionRecord, FinishWorkAssessment } from "@srgical/studio-shared";
import type { WorktreeLaneSummary } from "./worktree-lanes";

export function assessFinishWork(
  lane: WorktreeLaneSummary,
  sessions: AgentSessionRecord[],
  options: { activeOperation?: boolean } = {}
): FinishWorkAssessment {
  const laneSessions = sessions.filter((session) => session.workspaceBindings.some((binding) => binding.laneId === lane.laneId));
  const activeSessions = laneSessions.filter((session) => session.lifecycle === "active");
  const changedFileCount = lane.stagedCount + lane.unstagedCount + lane.untrackedCount;
  const blockers: string[] = [];
  const removalBlockers: string[] = [];
  const warnings: string[] = [];

  if (options.activeOperation) blockers.push("An agent operation is still running in this worktree.");
  if (lane.source !== "managed") blockers.push("Adopt this worktree into Srgical before using the Finish Work workflow.");
  if (lane.lifecycle === "missing") blockers.push("The registered worktree is missing and must be repaired before finishing it.");
  if (lane.lifecycle === "prunable") blockers.push("Git marks this worktree as prunable; reconcile its metadata first.");
  if (lane.isCurrentCheckout) removalBlockers.push("The repository's primary checkout cannot be removed.");
  if (lane.conflictCount > 0) removalBlockers.push(`${lane.conflictCount} conflicted file${lane.conflictCount === 1 ? " remains" : "s remain"}.`);
  if (changedFileCount > 0) removalBlockers.push(`${changedFileCount} uncommitted file change${changedFileCount === 1 ? " is" : "s are"} not preserved in the branch.`);
  if (lane.deleteLocked) removalBlockers.push("Worktree removal is locked.");
  if (lane.gitLocked) removalBlockers.push("Git has locked this worktree.");
  if (lane.aheadCount > 0) warnings.push(`${lane.aheadCount} commit${lane.aheadCount === 1 ? " is" : "s are"} ahead of ${lane.baseRef ?? "the base"}; the branch will be retained.`);
  if (lane.behindCount > 0) warnings.push(`The branch is ${lane.behindCount} commit${lane.behindCount === 1 ? "" : "s"} behind ${lane.baseRef ?? "the base"}.`);
  if (activeSessions.length === 0) warnings.push("No active session is bound to this worktree; only lane state will be archived.");

  return {
    laneId: lane.laneId,
    planId: lane.planId,
    branchName: lane.branchName,
    lifecycle: lane.lifecycle,
    sessionCount: laneSessions.length,
    activeSessionCount: activeSessions.length,
    aheadCount: lane.aheadCount,
    behindCount: lane.behindCount,
    changedFileCount,
    conflictCount: lane.conflictCount,
    deleteLocked: lane.deleteLocked,
    isCurrentCheckout: lane.isCurrentCheckout,
    blockers,
    removalBlockers,
    warnings,
    preserved: [
      `${laneSessions.length} durable session transcript${laneSessions.length === 1 ? "" : "s"}`,
      lane.branchName ? `branch ${lane.branchName}` : "detached commit state",
      "plan artifacts and execution history",
      "session skill hashes and workspace binding history"
    ],
    canArchive: blockers.length === 0,
    canRemoveWorktree: blockers.length === 0 && removalBlockers.length === 0 && lane.canRemove
  };
}
