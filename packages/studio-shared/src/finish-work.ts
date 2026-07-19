export type FinishWorkAssessment = {
  laneId: string;
  planId: string | null;
  branchName: string | null;
  lifecycle: "current" | "ready" | "working" | "conflicted" | "archived" | "missing" | "prunable";
  sessionCount: number;
  activeSessionCount: number;
  aheadCount: number;
  behindCount: number;
  changedFileCount: number;
  conflictCount: number;
  deleteLocked: boolean;
  isCurrentCheckout: boolean;
  blockers: string[];
  removalBlockers: string[];
  warnings: string[];
  preserved: string[];
  canArchive: boolean;
  canRemoveWorktree: boolean;
};

export type FinishWorkRequest = {
  laneId: string;
  archiveSessions: boolean;
  removeWorktree: boolean;
  confirmation: string;
};

export type FinishWorkResult = {
  laneId: string;
  archivedSessionIds: string[];
  worktreeRemoved: boolean;
  branchRetained: boolean;
};
