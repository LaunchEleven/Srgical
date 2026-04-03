import {
  detectAugment,
  dicePlanningPack as diceAugmentPlanningPack,
  requestPlanningAdvice as requestAugmentPlanningAdvice,
  requestPlannerReply as requestAugmentPlannerReply,
  runNextPrompt as runAugmentNextPrompt,
  writePlanningPack as writeAugmentPlanningPack
} from "./augment";
import {
  detectClaude,
  dicePlanningPack as diceClaudePlanningPack,
  requestPlanningAdvice as requestClaudePlanningAdvice,
  requestPlannerReply as requestClaudePlannerReply,
  runNextPrompt as runClaudeNextPrompt,
  writePlanningPack as writeClaudePlanningPack
} from "./claude";
import {
  detectCodex,
  dicePlanningPack as diceCodexPlanningPack,
  requestPlanningAdvice as requestCodexPlanningAdvice,
  requestPlannerReply as requestCodexPlannerReply,
  runNextPrompt as runCodexNextPrompt,
  writePlanningPack as writeCodexPlanningPack
} from "./codex";
import type { PlanDiceOptions } from "./plan-dicing";
import type { ChatMessage } from "./prompts";
import type { PlanningPackState } from "./planning-pack-state";
import { loadStoredActiveAgentId, saveStoredActiveAgentId } from "./studio-session";
import type { PlanningPathOptions } from "./workspace";

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
  requestPlannerReply(workspaceRoot: string, messages: ChatMessage[], options?: AgentInvocationOptions): Promise<string>;
  requestPlanningAdvice(
    workspaceRoot: string,
    messages: ChatMessage[],
    packState: PlanningPackState,
    options?: AgentInvocationOptions
  ): Promise<string>;
  dicePlanningPack(
    workspaceRoot: string,
    messages: ChatMessage[],
    diceOptions: PlanDiceOptions,
    options?: AgentInvocationOptions
  ): Promise<string>;
  writePlanningPack(workspaceRoot: string, messages: ChatMessage[], options?: AgentInvocationOptions): Promise<string>;
  runNextPrompt(workspaceRoot: string, prompt: string, options?: AgentInvocationOptions): Promise<string>;
};

export type AgentInvocationOptions = PlanningPathOptions & {
  onOutputChunk?: (chunk: string) => void;
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
  requestPlanningAdvice: requestCodexPlanningAdvice,
  dicePlanningPack: diceCodexPlanningPack,
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
  requestPlanningAdvice: requestClaudePlanningAdvice,
  dicePlanningPack: diceClaudePlanningPack,
  writePlanningPack: writeClaudePlanningPack,
  runNextPrompt: runClaudeNextPrompt
};

const augmentAdapter: AgentAdapter = {
  id: "augment",
  label: "Augment CLI",
  async detectStatus(): Promise<AgentStatus> {
    const status = await detectAugment();
    return {
      id: "augment",
      label: "Augment CLI",
      available: status.available,
      command: status.command,
      version: status.version,
      error: status.error
    };
  },
  requestPlannerReply: requestAugmentPlannerReply,
  requestPlanningAdvice: requestAugmentPlanningAdvice,
  dicePlanningPack: diceAugmentPlanningPack,
  writePlanningPack: writeAugmentPlanningPack,
  runNextPrompt: runAugmentNextPrompt
};

const defaultAgentAdapters: AgentAdapter[] = [codexAdapter, claudeAdapter, augmentAdapter];

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

export async function resolvePrimaryAgent(workspaceRoot?: string, options: PlanningPathOptions = {}): Promise<ResolvedPrimaryAgent> {
  const statuses = await collectAgentStatuses();
  const status = await resolvePrimaryAgentStatus(statuses, workspaceRoot, options);
  const adapter = getAgentAdapterById(status.id) ?? getSupportedAgentAdapters()[0];

  syncPrimaryAgent(adapter.id);

  return {
    adapter,
    status,
    statuses
  };
}

export async function detectPrimaryAgent(workspaceRoot?: string, options: PlanningPathOptions = {}): Promise<AgentStatus> {
  return (await resolvePrimaryAgent(workspaceRoot, options)).status;
}

export async function resolveExecutionAgent(
  workspaceRoot: string,
  overrideId?: string | null,
  options: PlanningPathOptions = {}
): Promise<ResolvedPrimaryAgent> {
  const normalizedOverrideId = overrideId?.trim().toLowerCase();

  if (!normalizedOverrideId) {
    return resolvePrimaryAgent(workspaceRoot, options);
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

export async function requestPlannerReply(
  workspaceRoot: string,
  messages: ChatMessage[],
  options: AgentInvocationOptions = {}
): Promise<string> {
  const { adapter } = await resolvePrimaryAgent(workspaceRoot, options);
  return adapter.requestPlannerReply(workspaceRoot, messages, options);
}

export async function writePlanningPack(
  workspaceRoot: string,
  messages: ChatMessage[],
  options: AgentInvocationOptions = {}
): Promise<string> {
  const { adapter } = await resolvePrimaryAgent(workspaceRoot, options);
  return adapter.writePlanningPack(workspaceRoot, messages, options);
}

export async function dicePlanningPack(
  workspaceRoot: string,
  messages: ChatMessage[],
  diceOptions: PlanDiceOptions,
  options: AgentInvocationOptions = {}
): Promise<string> {
  const { adapter } = await resolvePrimaryAgent(workspaceRoot, options);
  return adapter.dicePlanningPack(workspaceRoot, messages, diceOptions, options);
}

export async function requestPlanningAdvice(
  workspaceRoot: string,
  messages: ChatMessage[],
  packState: PlanningPackState,
  options: AgentInvocationOptions = {}
): Promise<string> {
  const { adapter } = await resolvePrimaryAgent(workspaceRoot, options);
  return adapter.requestPlanningAdvice(workspaceRoot, messages, packState, options);
}

export async function runNextPrompt(
  workspaceRoot: string,
  prompt: string,
  options: {
    agentId?: string | null;
    planId?: string | null;
    onOutputChunk?: (chunk: string) => void;
  } = {}
): Promise<string> {
  const { adapter } = await resolveExecutionAgent(workspaceRoot, options.agentId, { planId: options.planId });
  return adapter.runNextPrompt(workspaceRoot, prompt, { planId: options.planId, onOutputChunk: options.onOutputChunk });
}

export async function selectPrimaryAgent(
  workspaceRoot: string,
  id: string,
  options: PlanningPathOptions = {}
): Promise<ResolvedPrimaryAgent> {
  const normalizedId = id.trim().toLowerCase();
  const statuses = await collectAgentStatuses();
  const status = statuses.find((candidate) => candidate.id === normalizedId);

  if (!status) {
    throw new Error(`Unknown agent \`${id}\`. Supported agents: ${getSupportedAgentAdapters().map((adapter) => adapter.id).join(", ")}.`);
  }

  if (!status.available) {
    throw new Error(`Cannot activate ${status.label}: ${status.error ?? `${status.command} is not available`}.`);
  }

  await saveStoredActiveAgentId(workspaceRoot, status.id, options);

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

async function resolvePrimaryAgentStatus(
  statuses: AgentStatus[],
  workspaceRoot?: string,
  options: PlanningPathOptions = {}
): Promise<AgentStatus> {
  const storedId = workspaceRoot ? await loadStoredActiveAgentId(workspaceRoot, options) : null;

  if (storedId) {
    const storedStatus = statuses.find((status) => status.id === storedId);

    if (storedStatus) {
      return storedStatus;
    }

    if (workspaceRoot) {
      await saveStoredActiveAgentId(workspaceRoot, null, options);
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
