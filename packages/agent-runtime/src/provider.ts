import type {
  AgentCapability,
  AgentEventDraft,
  AgentPermissionMode,
  AgentSessionRecord
} from "@srgical/studio-shared";

export type AgentProviderStatus = {
  providerId: string;
  label: string;
  available: boolean;
  authenticated: boolean | null;
  capabilities: AgentCapability[];
  detail?: string;
};

export type AgentSessionStartOptions = {
  session: AgentSessionRecord;
  prompt: string;
  resumeProviderSessionId?: string | null;
  fork?: boolean;
  emit(event: AgentEventDraft): Promise<void>;
  signal: AbortSignal;
};

export type AgentPermissionResolution = {
  behavior: "allow" | "deny" | "defer";
  message?: string;
  updatedInput?: unknown;
};

export type AgentQuestionResolution = {
  answers: Record<string, string>;
};

export interface AgentSessionHandle {
  readonly providerSessionId: string | null;
  readonly completion: Promise<void>;
  interrupt(): Promise<void>;
  setPermissionMode?(mode: AgentPermissionMode): Promise<void>;
  resolvePermission?(requestId: string, resolution: AgentPermissionResolution): Promise<void>;
  resolveQuestion?(requestId: string, resolution: AgentQuestionResolution): Promise<void>;
  rewind?(checkpointId: string, dryRun?: boolean): Promise<{ changedFiles: string[] }>;
}

export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  detect(): Promise<AgentProviderStatus>;
  start(options: AgentSessionStartOptions): Promise<AgentSessionHandle>;
}
