import type { ChatMessage } from "../../../apps/cli/src/core/prompts";
import type { PlanningPackState } from "../../../apps/cli/src/core/planning-pack-state";
import type { StudioUiConfig } from "../../../apps/cli/src/core/studio-ui-config";
import type { PlanDiceOptions } from "../../../apps/cli/src/core/plan-dicing";
import type { StudioMode, StudioSettings, StudioTheme } from "@srgical/studio-shared";

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
  | "command";

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
};

export type StudioActionState = {
  enabled: boolean;
  blockedReason: string | null;
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
};

export type RepoSnapshot = {
  repoRoot: string;
  repoLabel: string;
  currentWorkspace: string;
  requestedPlanId: string | null;
  requestedMode: StudioMode | null;
  lanes: LaneSummary[];
};

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
  uiConfig: StudioUiConfig;
  settings: StudioSettings;
  theme: StudioTheme;
  actions: Record<StudioActionId, StudioActionState>;
  footerText: string;
};

export type StudioEvent =
  | {
      type: "snapshot";
      snapshot: StudioSnapshot;
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
