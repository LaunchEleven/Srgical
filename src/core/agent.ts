import {
  detectClaude,
  requestPlannerReply as requestClaudePlannerReply,
  runNextPrompt as runClaudeNextPrompt,
  writePlanningPack as writeClaudePlanningPack
} from "./claude";
import {
  detectCodex,
  requestPlannerReply as requestCodexPlannerReply,
  runNextPrompt as runCodexNextPrompt,
  writePlanningPack as writeCodexPlanningPack
} from "./codex";
import type { ChatMessage } from "./prompts";
import { loadStoredActiveAgentId, saveStoredActiveAgentId } from "./studio-session";

export type AgentStatus = {
  id: string;
  label: string;
  available: boolean;
  command: string;
  version?: string;
  error?: string;
};

export type AgentAdapter = {
  id: string;
  label: string;
  detectStatus(): Promise<AgentStatus>;
  requestPlannerReply(workspaceRoot: string, messages: ChatMessage[]): Promise<string>;
  writePlanningPack(workspaceRoot: string, messages: ChatMessage[]): Promise<string>;
  runNextPrompt(workspaceRoot: string, prompt: string): Promise<string>;
};

export type ResolvedPrimaryAgent = {
  adapter: AgentAdapter;
  status: AgentStatus;
  statuses: AgentStatus[];
};

const codexAdapter: AgentAdapter = {
  id: "codex",
  label: "Codex",
  async detectStatus(): Promise<AgentStatus> {
    const status = await detectCodex();
    return {
      id: "codex",
      label: "Codex",
      available: status.available,
      command: status.command,
      version: status.version,
      error: status.error
    };
  },
  requestPlannerReply: requestCodexPlannerReply,
  writePlanningPack: writeCodexPlanningPack,
  runNextPrompt: runCodexNextPrompt
};

const claudeAdapter: AgentAdapter = {
  id: "claude",
  label: "Claude Code",
  async detectStatus(): Promise<AgentStatus> {
    const status = await detectClaude();
    return {
      id: "claude",
      label: "Claude Code",
      available: status.available,
      command: status.command,
      version: status.version,
      error: status.error
    };
  },
  requestPlannerReply: requestClaudePlannerReply,
  writePlanningPack: writeClaudePlanningPack,
  runNextPrompt: runClaudeNextPrompt
};

const defaultAgentAdapters: AgentAdapter[] = [codexAdapter, claudeAdapter];

let registeredAgentAdapters: AgentAdapter[] = [...defaultAgentAdapters];
let primaryAgentId = registeredAgentAdapters[0].id;

export function getSupportedAgentAdapters(): AgentAdapter[] {
  return [...registeredAgentAdapters];
}

export function getPrimaryAgentAdapter(): AgentAdapter {
  return getAgentAdapterById(primaryAgentId) ?? getSupportedAgentAdapters()[0];
}

export async function detectSupportedAgents(workspaceRoot?: string): Promise<AgentStatus[]> {
  const statuses = await collectAgentStatuses();
  syncPrimaryAgent((await resolvePrimaryAgentStatus(statuses, workspaceRoot)).id);
  return statuses;
}

export async function resolvePrimaryAgent(workspaceRoot?: string): Promise<ResolvedPrimaryAgent> {
  const statuses = await collectAgentStatuses();
  const status = await resolvePrimaryAgentStatus(statuses, workspaceRoot);
  const adapter = getAgentAdapterById(status.id) ?? getSupportedAgentAdapters()[0];

  syncPrimaryAgent(adapter.id);

  return {
    adapter,
    status,
    statuses
  };
}

export async function detectPrimaryAgent(workspaceRoot?: string): Promise<AgentStatus> {
  return (await resolvePrimaryAgent(workspaceRoot)).status;
}

export async function resolveExecutionAgent(workspaceRoot: string, overrideId?: string | null): Promise<ResolvedPrimaryAgent> {
  const normalizedOverrideId = overrideId?.trim().toLowerCase();

  if (!normalizedOverrideId) {
    return resolvePrimaryAgent(workspaceRoot);
  }

  const statuses = await collectAgentStatuses();
  const status = statuses.find((candidate) => candidate.id === normalizedOverrideId);

  if (!status) {
    throw new Error(
      `Unknown agent \`${overrideId}\`. Supported agents: ${getSupportedAgentAdapters().map((adapter) => adapter.id).join(", ")}.`
    );
  }

  if (!status.available) {
    throw new Error(`Cannot use ${status.label} for this run: ${status.error ?? `${status.command} is not available`}.`);
  }

  const adapter = getAgentAdapterById(status.id) ?? getSupportedAgentAdapters()[0];
  syncPrimaryAgent(adapter.id);

  return {
    adapter,
    status,
    statuses
  };
}

export async function requestPlannerReply(workspaceRoot: string, messages: ChatMessage[]): Promise<string> {
  const { adapter } = await resolvePrimaryAgent(workspaceRoot);
  return adapter.requestPlannerReply(workspaceRoot, messages);
}

export async function writePlanningPack(workspaceRoot: string, messages: ChatMessage[]): Promise<string> {
  const { adapter } = await resolvePrimaryAgent(workspaceRoot);
  return adapter.writePlanningPack(workspaceRoot, messages);
}

export async function runNextPrompt(
  workspaceRoot: string,
  prompt: string,
  options: {
    agentId?: string | null;
  } = {}
): Promise<string> {
  const { adapter } = await resolveExecutionAgent(workspaceRoot, options.agentId);
  return adapter.runNextPrompt(workspaceRoot, prompt);
}

export async function selectPrimaryAgent(workspaceRoot: string, id: string): Promise<ResolvedPrimaryAgent> {
  const normalizedId = id.trim().toLowerCase();
  const statuses = await collectAgentStatuses();
  const status = statuses.find((candidate) => candidate.id === normalizedId);

  if (!status) {
    throw new Error(`Unknown agent \`${id}\`. Supported agents: ${getSupportedAgentAdapters().map((adapter) => adapter.id).join(", ")}.`);
  }

  if (!status.available) {
    throw new Error(`Cannot activate ${status.label}: ${status.error ?? `${status.command} is not available`}.`);
  }

  await saveStoredActiveAgentId(workspaceRoot, status.id);

  const adapter = getAgentAdapterById(status.id) ?? getSupportedAgentAdapters()[0];
  syncPrimaryAgent(adapter.id);

  return {
    adapter,
    status,
    statuses
  };
}

export function resetAgentAdaptersForTesting(): void {
  registeredAgentAdapters = [...defaultAgentAdapters];
  primaryAgentId = registeredAgentAdapters[0].id;
}

export function setAgentAdaptersForTesting(adapters: AgentAdapter[]): void {
  registeredAgentAdapters = adapters.length > 0 ? [...adapters] : [...defaultAgentAdapters];
  primaryAgentId = registeredAgentAdapters[0].id;
}

async function collectAgentStatuses(): Promise<AgentStatus[]> {
  return Promise.all(getSupportedAgentAdapters().map((adapter) => adapter.detectStatus()));
}

async function resolvePrimaryAgentStatus(statuses: AgentStatus[], workspaceRoot?: string): Promise<AgentStatus> {
  const storedId = workspaceRoot ? await loadStoredActiveAgentId(workspaceRoot) : null;

  if (storedId) {
    const storedStatus = statuses.find((status) => status.id === storedId);

    if (storedStatus) {
      return storedStatus;
    }

    if (workspaceRoot) {
      await saveStoredActiveAgentId(workspaceRoot, null);
    }
  }

  return statuses.find((status) => status.available) ?? statuses[0];
}

function getAgentAdapterById(id: string): AgentAdapter | undefined {
  return registeredAgentAdapters.find((adapter) => adapter.id === id);
}

function syncPrimaryAgent(id: string): void {
  const adapter = getAgentAdapterById(id) ?? getSupportedAgentAdapters()[0];
  primaryAgentId = adapter.id;
}
