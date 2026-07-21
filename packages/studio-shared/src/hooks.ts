export type HookTrigger = "turn.received" | "turn.completed";

export type SkillHookHandler = {
  type: "skill";
  skillId: string;
};

export type McpHookHandler = {
  type: "mcp";
  connectorId: string;
  toolName: string;
};

export type HookHandler = SkillHookHandler | McpHookHandler;

export type HookDefinition = {
  hookId: string;
  label: string;
  description: string;
  trigger: HookTrigger;
  handler: HookHandler;
  instruction: string;
  enabled: boolean;
  blocking: boolean;
  priority: number;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
};

export type HookRegistrySnapshot = {
  hooks: HookDefinition[];
};

export type HookUpsertInput = {
  hookId?: string;
  label: string;
  description?: string;
  trigger: HookTrigger;
  handler: HookHandler;
  instruction: string;
  enabled?: boolean;
  blocking?: boolean;
  priority?: number;
  timeoutMs?: number;
};
