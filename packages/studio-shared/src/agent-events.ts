export type AgentPermissionMode = "default" | "dontAsk" | "acceptEdits" | "bypassPermissions" | "plan" | "auto";

export type AgentSessionStatus = "idle" | "starting" | "running" | "waiting" | "completed" | "failed" | "interrupted";

export type AgentSessionLifecycle = "active" | "archived" | "deleted";

export type AgentSessionWorkspaceBinding = {
  bindingId: string;
  laneId: string;
  workspace: string;
  branchName: string | null;
  startingCommit: string | null;
  endingCommit: string | null;
  attachedAt: string;
  retiredAt: string | null;
  retirementReason: string | null;
};

export type AgentCapability =
  | "streaming"
  | "sessions"
  | "resume"
  | "fork"
  | "interrupt"
  | "permissions"
  | "questions"
  | "tools"
  | "tasks"
  | "usage"
  | "checkpoints"
  | "skills";

export type AgentSessionRecord = {
  version: 1;
  sessionId: string;
  providerId: string;
  providerSessionId: string | null;
  repoId: string;
  laneId: string;
  workspace: string;
  planId: string | null;
  title: string;
  model: string | null;
  permissionMode: AgentPermissionMode;
  status: AgentSessionStatus;
  lifecycle: AgentSessionLifecycle;
  parentSessionId: string | null;
  pinnedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  lastMessagePreview: string | null;
  workspaceBindings: AgentSessionWorkspaceBinding[];
  capabilities: AgentCapability[];
  effectiveSkillHashes: string[];
  createdAt: string;
  updatedAt: string;
  lastEventSequence: number;
};

export type AgentEventKind =
  | "auth.status"
  | "session.started"
  | "session.status"
  | "session.completed"
  | "session.failed"
  | "message.started"
  | "message.delta"
  | "message.completed"
  | "tool.started"
  | "tool.progress"
  | "tool.completed"
  | "tool.failed"
  | "permission.requested"
  | "permission.resolved"
  | "question.requested"
  | "question.resolved"
  | "task.started"
  | "task.progress"
  | "task.completed"
  | "files.changed"
  | "usage.updated"
  | "rate_limit.updated"
  | "checkpoint.created"
  | "checkpoint.rewound"
  | "workspace.retired";

export type AgentEventPayloadMap = {
  "auth.status": {
    authenticated: boolean | null;
    authenticating?: boolean;
    detail?: string;
  };
  "session.started": {
    providerSessionId?: string | null;
    model?: string | null;
  };
  "session.status": {
    status: AgentSessionStatus;
    detail?: string;
  };
  "session.completed": {
    result?: string;
  };
  "session.failed": {
    message: string;
    code?: string;
  };
  "message.started": {
    messageId: string;
    role: "user" | "assistant" | "system";
  };
  "message.delta": {
    messageId: string;
    text: string;
  };
  "message.completed": {
    messageId: string;
    text: string;
  };
  "tool.started": {
    toolUseId: string;
    toolName: string;
    input?: unknown;
    parentToolUseId?: string | null;
  };
  "tool.progress": {
    toolUseId: string;
    message: string;
    elapsedSeconds?: number;
  };
  "tool.completed": {
    toolUseId: string;
    output?: unknown;
    changedFiles?: string[];
  };
  "tool.failed": {
    toolUseId: string;
    message: string;
  };
  "permission.requested": {
    requestId: string;
    toolUseId: string;
    toolName: string;
    input: unknown;
    suggestions?: unknown[];
    title?: string;
    description?: string;
  };
  "permission.resolved": {
    requestId: string;
    behavior: "allow" | "deny" | "defer";
    message?: string;
  };
  "question.requested": {
    requestId: string;
    questions: AgentQuestion[];
  };
  "question.resolved": {
    requestId: string;
    answers: Record<string, string>;
  };
  "task.started": AgentTaskPayload;
  "task.progress": AgentTaskPayload;
  "task.completed": AgentTaskPayload;
  "files.changed": {
    paths: string[];
  };
  "usage.updated": {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    costUsd?: number;
  };
  "rate_limit.updated": {
    status: string;
    resetsAt?: string;
    utilization?: number;
  };
  "checkpoint.created": {
    checkpointId: string;
    userMessageId?: string;
    description?: string;
  };
  "checkpoint.rewound": {
    checkpointId: string;
    changedFiles?: string[];
  };
  "workspace.retired": {
    laneId: string;
    workspace: string;
    branchName: string | null;
    endingCommit: string | null;
    reason: string;
    aheadCount: number;
    behindCount: number;
    changedFileCount: number;
    conflictCount: number;
  };
};

export type AgentQuestion = {
  question: string;
  header: string;
  options: Array<{
    label: string;
    description: string;
    preview?: string;
  }>;
  multiSelect: boolean;
};

export type AgentTaskPayload = {
  taskId: string;
  subject: string;
  status?: string;
  summary?: string;
  parentTaskId?: string | null;
};

export type AgentEvent<K extends AgentEventKind = AgentEventKind> = {
  [P in K]: {
    version: 1;
    eventId: string;
    sequence: number;
    timestamp: string;
    sessionId: string;
    kind: P;
    payload: AgentEventPayloadMap[P];
    providerPayload?: unknown;
  }
}[K];

export type AgentEventDraft<K extends AgentEventKind = AgentEventKind> = {
  [P in K]: {
    kind: P;
    payload: AgentEventPayloadMap[P];
    providerPayload?: unknown;
  }
}[K];
