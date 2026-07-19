import type { ChatMessage } from "../../../apps/cli/src/core/prompts";
import type { PlanningPackState } from "../../../apps/cli/src/core/planning-pack-state";
import type { StudioUiConfig } from "../../../apps/cli/src/core/studio-ui-config";
import type { PlanDiceOptions } from "../../../apps/cli/src/core/plan-dicing";
import type { AgentEvent, AgentSessionRecord, SkillRegistrySnapshot, StudioMode, StudioSettings, StudioTheme } from "@srgical/studio-shared";
import type { AgentProviderStatus } from "@srgical/agent-runtime";

export type StudioActionId =
  | "gather"
  | "context"
  | "build"
  | "slice"
  | "approve"
  | "review"
  | "run"
  | "auto"
  | "checkpoint"
  | "unblock"
  | "stop"
  | "switch-mode"
  | "import"
  | "wheel"
  | "theme"
  | "command"
  | "reference-toggle"
  | "reference-autoselect"
  | "reference-clear"
  | "reference-root-add"
  | "reference-root-remove"
  | "permission-resolve"
  | "question-resolve"
  | "interrupt-agent"
  | "rewind"
  | "skill-toggle"
  | "skill-trust"
  | "skill-directory-add"
  | "skill-directory-remove"
  | "session-create"
  | "session-switch"
  | "session-fork"
  | "session-rename"
  | "session-pin"
  | "session-archive"
  | "session-delete"
  | "retry-agent";

export type StudioActionRequest = {
  type: StudioActionId;
  command?: string;
  filePath?: string;
  mode?: StudioMode;
  maxSteps?: number;
  wheelSensitivity?: number;
  themeId?: string;
  diceOptions?: PlanDiceOptions;
  label?: string;
  referenceId?: string;
  selected?: boolean;
  rootPath?: string;
  announce?: boolean;
  requestId?: string;
  behavior?: "allow" | "deny" | "defer";
  message?: string;
  updatedInput?: unknown;
  answers?: Record<string, string>;
  checkpointId?: string;
  dryRun?: boolean;
  skillSource?: string;
  trust?: "trusted" | "review" | "blocked";
  directoryPath?: string;
  sessionId?: string;
  title?: string;
  pinned?: boolean;
};

export type StudioActionState = {
  enabled: boolean;
  blockedReason: string | null;
};

export type PrepareClarityCheck = {
  id: string;
  title: string;
  passed: boolean;
  whyItMatters: string;
  nextMove: string;
};

export type PrepareClarityView = {
  contextDocument: string;
  contextGrounded: boolean;
  contextUpdatedAt: string | null;
  coachHeadline: string;
  coachSummary: string;
  checks: PrepareClarityCheck[];
  repoTruth: string | null;
  evidenceSection: string | null;
  unknownsSection: string | null;
  workingAgreements: string | null;
  selectedGuidance: string | null;
};

export type ReferenceViewEntry = {
  id: string;
  title: string;
  summary: string;
  path: string;
  tags: string[];
  selected: boolean;
  recommended: boolean;
  recommendationReason: string | null;
};

export type ReferenceView = {
  entries: ReferenceViewEntry[];
  selectedIds: string[];
  recommendedIds: string[];
  roots: string[];
};

export type LaneSummary = {
  laneId: string;
  planId: string | null;
  branchName: string | null;
  worktreePath: string;
  workspaceLabel: string;
  dirty: boolean;
  archived: boolean;
  removed: boolean;
  isCurrentCheckout: boolean;
  canRemove: boolean;
  deleteLocked: boolean;
  lastMode: StudioMode | null;
  createdAt: string | null;
  openedAt: string | null;
  unlockedAt: string | null;
  source: "current" | "managed" | "detected";
  head: string | null;
  lifecycle: "current" | "ready" | "working" | "conflicted" | "archived" | "missing" | "prunable";
  baseRef: string | null;
  mergeBase: string | null;
  aheadCount: number;
  behindCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
  gitLocked: boolean;
  prunable: boolean;
  nextAction: string;
};

export type RepoSnapshot = {
  repoRoot: string;
  repoLabel: string;
  currentWorkspace: string;
  requestedPlanId: string | null;
  requestedMode: StudioMode | null;
  lanes: LaneSummary[];
  sessions: AgentSessionRecord[];
};

export type { FinishWorkAssessment, FinishWorkRequest, FinishWorkResult } from "@srgical/studio-shared";

export type LaneCreateRequest = {
  planId: string;
  mode: StudioMode;
};

export type LaneOpenResponse = {
  laneId: string;
  studioToken: string;
  url: string;
};

export type StudioSnapshot = {
  mode: StudioMode;
  workspace: string;
  workspaceLabel: string;
  repoRoot: string;
  planId: string;
  laneId: string;
  branchName: string | null;
  messages: ChatMessage[];
  state: PlanningPackState;
  busy: boolean;
  busyStatus: string;
  agentLabel: string;
  agentProvider: AgentProviderStatus;
  agentSession: AgentSessionRecord;
  agentSessions: AgentSessionRecord[];
  recentAgentEvents: AgentEvent[];
  uiConfig: StudioUiConfig;
  settings: StudioSettings;
  theme: StudioTheme;
  actions: Record<StudioActionId, StudioActionState>;
  prepareClarity: PrepareClarityView | null;
  references: ReferenceView;
  skills: SkillRegistrySnapshot;
  footerText: string;
};

export type StudioEvent =
  | {
      type: "snapshot";
      snapshot: StudioSnapshot;
    }
  | {
      type: "agent";
      event: AgentEvent;
    }
  | {
      type: "action";
      phase: "start" | "finish";
      action: StudioActionId;
      snapshot: StudioSnapshot;
    };

export type StudioListener = (event: StudioEvent) => void;

export type StudioController = {
  start(): Promise<void>;
  close(): Promise<void>;
  getSnapshot(): StudioSnapshot;
  subscribe(listener: StudioListener): () => void;
  submitInput(text: string): Promise<void>;
  dispatch(request: StudioActionRequest): Promise<void>;
};
