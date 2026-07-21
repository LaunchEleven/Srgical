export type PromptActionKind = "built-in" | "skill";

export type PromptActionRecord = {
  actionId: string;
  kind: PromptActionKind;
  label: string;
  description: string;
  prompt: string;
  skillId: string | null;
  skillSource: string | null;
  permissionMode: "plan" | "acceptEdits";
  enabled: boolean;
  blockedReason: string | null;
  emphasis: "normal" | "warning";
};

export type WorktreeDiagnosticsView = {
  baseRef: string | null;
  mergeBase: string | null;
  aheadCount: number;
  behindCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
};
