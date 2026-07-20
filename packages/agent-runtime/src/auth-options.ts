import os from "node:os";
import path from "node:path";
import type { StudioAuthOptionId, StudioAuthOptionStatus } from "@srgical/studio-shared";
import { AnthropicAgentProvider, type AnthropicAuthMethod } from "./anthropic-provider";
import { CodexAgentProvider, type CodexAuthMethod } from "./codex-provider";
import type { AgentProvider } from "./provider";

type AuthOptionDefinition = Omit<StudioAuthOptionStatus, "available" | "authenticated" | "selected" | "detail"> & {
  create(env: NodeJS.ProcessEnv, authFilePath?: string): AgentProvider;
};

const DEFINITIONS: AuthOptionDefinition[] = [
  {
    id: "codex-chatgpt",
    providerId: "codex-sdk:chatgpt",
    providerLabel: "Codex",
    label: "ChatGPT subscription",
    description: "Use the ChatGPT account signed in through Codex and draw from included Codex plan usage.",
    authenticationType: "subscription",
    setupHint: "Run `codex login` and choose Sign in with ChatGPT.",
    create: (env, authFilePath) => new CodexAgentProvider({ env, authFilePath, authMethod: "chatgpt" })
  },
  {
    id: "codex-api-key",
    providerId: "codex-sdk:api-key",
    providerLabel: "Codex",
    label: "OpenAI API key",
    description: "Use CODEX_API_KEY or OPENAI_API_KEY and bill Codex work through the OpenAI API account.",
    authenticationType: "api-key",
    setupHint: "Set CODEX_API_KEY or OPENAI_API_KEY before starting Studio.",
    create: (env, authFilePath) => new CodexAgentProvider({ env, authFilePath, authMethod: "api-key" })
  },
  {
    id: "claude-api-key",
    providerId: "anthropic-agent-sdk:api-key",
    providerLabel: "Claude",
    label: "Claude API key",
    description: "Use an Anthropic Console API key through the native Claude Agent SDK.",
    authenticationType: "api-key",
    setupHint: "Set ANTHROPIC_API_KEY before starting Studio.",
    create: (env) => new AnthropicAgentProvider({ env, authMethod: "api-key" })
  },
  {
    id: "claude-bedrock",
    providerId: "anthropic-agent-sdk:bedrock",
    providerLabel: "Claude",
    label: "Amazon Bedrock",
    description: "Use Claude through an authenticated Amazon Bedrock environment.",
    authenticationType: "cloud",
    setupHint: "Set CLAUDE_CODE_USE_BEDROCK=1 and configure AWS credentials.",
    create: (env) => new AnthropicAgentProvider({ env, authMethod: "bedrock" })
  },
  {
    id: "claude-vertex",
    providerId: "anthropic-agent-sdk:vertex",
    providerLabel: "Claude",
    label: "Google Vertex AI",
    description: "Use Claude through an authenticated Google Vertex AI environment.",
    authenticationType: "cloud",
    setupHint: "Set CLAUDE_CODE_USE_VERTEX=1 and configure Google Cloud credentials.",
    create: (env) => new AnthropicAgentProvider({ env, authMethod: "vertex" })
  },
  {
    id: "claude-foundry",
    providerId: "anthropic-agent-sdk:foundry",
    providerLabel: "Claude",
    label: "Microsoft Foundry",
    description: "Use Claude through an authenticated Microsoft Foundry environment.",
    authenticationType: "cloud",
    setupHint: "Set CLAUDE_CODE_USE_FOUNDRY=1 and configure Foundry credentials.",
    create: (env) => new AnthropicAgentProvider({ env, authMethod: "foundry" })
  }
];

export async function detectAgentAuthOptions(
  preferredAuthOptionId: StudioAuthOptionId | null,
  options: { env?: NodeJS.ProcessEnv; codexAuthFilePath?: string } = {}
): Promise<StudioAuthOptionStatus[]> {
  const env = options.env ?? process.env;
  const codexAuthFilePath = options.codexAuthFilePath
    ?? path.join(env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"), "auth.json");

  return Promise.all(DEFINITIONS.map(async (definition) => {
    const status = await definition.create(env, codexAuthFilePath).detect();
    return {
      id: definition.id,
      providerId: definition.providerId,
      providerLabel: definition.providerLabel,
      label: definition.label,
      description: definition.description,
      authenticationType: definition.authenticationType,
      available: status.available,
      authenticated: status.available && status.authenticated === true,
      selected: definition.id === preferredAuthOptionId,
      detail: status.detail ?? (status.available ? "Provider available" : "Provider unavailable"),
      setupHint: definition.setupHint
    } satisfies StudioAuthOptionStatus;
  }));
}

export function createAgentProviderForAuthOption(
  id: StudioAuthOptionId,
  options: { env?: NodeJS.ProcessEnv; codexAuthFilePath?: string } = {}
): AgentProvider {
  const definition = DEFINITIONS.find((item) => item.id === id);
  if (!definition) throw new Error(`Unknown authentication option \`${id}\`.`);
  return definition.create(options.env ?? process.env, options.codexAuthFilePath);
}

export function authOptionIdFromProviderId(providerId: string | null | undefined): StudioAuthOptionId | null {
  return DEFINITIONS.find((item) => item.providerId === providerId)?.id ?? null;
}

export function selectAgentAuthOption(
  statuses: StudioAuthOptionStatus[],
  preferredAuthOptionId: StudioAuthOptionId | null
): StudioAuthOptionStatus | null {
  if (preferredAuthOptionId) {
    const preferred = statuses.find((item) => item.id === preferredAuthOptionId);
    if (!preferred) throw new Error(`Unknown authentication option \`${preferredAuthOptionId}\`.`);
    if (!preferred.authenticated) {
      throw new Error(`${preferred.providerLabel} · ${preferred.label} is selected but is not connected. ${preferred.setupHint}`);
    }
    return preferred;
  }
  return statuses.find((item) => item.authenticated) ?? null;
}

export function codexAuthMethodFromOption(id: StudioAuthOptionId): CodexAuthMethod | null {
  return id === "codex-chatgpt" ? "chatgpt" : id === "codex-api-key" ? "api-key" : null;
}

export function anthropicAuthMethodFromOption(id: StudioAuthOptionId): AnthropicAuthMethod | null {
  return id === "claude-api-key"
    ? "api-key"
    : id === "claude-bedrock"
      ? "bedrock"
      : id === "claude-vertex"
        ? "vertex"
        : id === "claude-foundry"
          ? "foundry"
          : null;
}
