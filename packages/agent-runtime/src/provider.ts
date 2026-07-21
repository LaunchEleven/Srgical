import type {
  AgentCapability,
  ConnectorRecord,
  AgentEventDraft,
  AgentPermissionMode,
  AgentSessionRecord,
  ResolvedMcpServerDefinition
} from "@srgical/studio-shared";

export type AgentProviderStatus = {
  providerId: string;
  label: string;
  available: boolean;
  authenticated: boolean | null;
  capabilities: AgentCapability[];
  detail?: string;
};

export type AgentModelOption = {
  id: string;
  label: string;
  description: string;
  resolvedId?: string;
  isDefault?: boolean;
};

export type AgentModelCatalog = {
  models: AgentModelOption[];
  defaultModelId: string | null;
  detail?: string;
};

export type AgentModelListOptions = {
  workspace: string;
  signal?: AbortSignal;
};

export type AgentSessionStartOptions = {
  session: AgentSessionRecord;
  prompt: string;
  resumeProviderSessionId?: string | null;
  fork?: boolean;
  emit(event: AgentEventDraft): Promise<void>;
  signal: AbortSignal;
  mcpServers?: Record<string, ResolvedMcpServerDefinition>;
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
  getMcpStatus?(): Promise<Array<Pick<ConnectorRecord, "connectorId" | "status" | "statusDetail" | "tools">>>;
  reconnectMcpServer?(connectorId: string): Promise<void>;
}

export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  detect(): Promise<AgentProviderStatus>;
  listModels?(options: AgentModelListOptions): Promise<AgentModelCatalog>;
  start(options: AgentSessionStartOptions): Promise<AgentSessionHandle>;
}
