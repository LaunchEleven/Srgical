import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ConnectorPreset,
  ConnectorRecord,
  ConnectorRegistrySnapshot,
  McpOAuthConfig,
  McpServerDefinition,
  McpTransport,
  ResolvedMcpServerDefinition
} from "@srgical/studio-shared";

type StoredConnector = Omit<ConnectorRecord,
  "missingEnvironmentVariables" | "status" | "statusDetail" | "tools">;

type StoredRegistry = {
  version: 1;
  connectors: StoredConnector[];
};

export type ConnectorInput = {
  connectorId?: string;
  label: string;
  description?: string;
  presetId?: string | null;
  enabled?: boolean;
  definition: McpServerDefinition;
};

export type ResolvedConnectorRegistry = {
  servers: Record<string, ResolvedMcpServerDefinition>;
  missingEnvironment: Record<string, string[]>;
};

export const CONNECTOR_CATALOG: ConnectorPreset[] = [
  {
    presetId: "linear",
    label: "Linear",
    description: "Search, create, and update Linear issues, projects, and comments.",
    category: "Project management",
    authDescription: "OAuth opens when Claude first connects. Linear also accepts a bearer token via a custom configuration.",
    setupUrl: "https://linear.app/docs/mcp",
    definition: { transport: "http", url: "https://mcp.linear.app/mcp" }
  },
  {
    presetId: "slack",
    label: "Slack",
    description: "Search conversations and files, read threads, and perform approved Slack actions.",
    category: "Communication",
    authDescription: "Requires workspace approval and Slack OAuth. A browser window opens when Claude first connects.",
    setupUrl: "https://docs.slack.dev/ai/slack-mcp-server/connect-to-claude/",
    definition: {
      transport: "http",
      url: "https://mcp.slack.com/mcp",
      oauth: { clientId: "1601185624273.8899143856786", callbackPort: 3118 }
    }
  },
  {
    presetId: "notion",
    label: "Notion",
    description: "Search, read, create, and update pages across your Notion workspace.",
    category: "Files and knowledge",
    authDescription: "Uses Notion's hosted OAuth flow. Authentication opens when the selected agent first connects.",
    setupUrl: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
    definition: { transport: "http", url: "https://mcp.notion.com/mcp" }
  },
  {
    presetId: "google-drive",
    label: "Google Drive",
    description: "Search, read, create, and download files through Google's hosted Drive MCP server.",
    category: "Files and knowledge",
    authDescription: "Developer Preview. Set GOOGLE_DRIVE_MCP_CLIENT_ID and GOOGLE_DRIVE_MCP_CLIENT_SECRET after configuring Google OAuth.",
    setupUrl: "https://developers.google.com/workspace/drive/api/guides/configure-mcp-server",
    definition: {
      transport: "http",
      url: "https://drivemcp.googleapis.com/mcp/v1",
      oauth: {
        clientId: "${GOOGLE_DRIVE_MCP_CLIENT_ID}",
        clientSecret: "${GOOGLE_DRIVE_MCP_CLIENT_SECRET}"
      }
    }
  }
];

export function getConnectorRegistryPath(repoId: string, homeDir = os.homedir()): string {
  return path.join(homeDir, ".srgical", "repos", repoId, "connectors.json");
}

export async function loadConnectorRegistry(
  repoId: string,
  options: { homeDir?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<ConnectorRegistrySnapshot> {
  const configPath = getConnectorRegistryPath(repoId, options.homeDir);
  const stored = await readStoredRegistry(configPath);
  const env = options.env ?? process.env;
  const connectors = stored.connectors.map((connector) => {
    const missingEnvironmentVariables = findMissingEnvironmentVariables(connector.definition, env);
    return {
      ...connector,
      missingEnvironmentVariables,
      status: connector.enabled
        ? missingEnvironmentVariables.length > 0 ? "missing-environment" as const : "ready" as const
        : "disabled" as const,
      statusDetail: missingEnvironmentVariables.length > 0
        ? `Set ${missingEnvironmentVariables.join(", ")} before starting a turn.`
        : null,
      tools: []
    };
  });
  return {
    configPath,
    catalog: CONNECTOR_CATALOG.map(clonePreset),
    connectors,
    enabledCount: connectors.filter((connector) => connector.enabled).length,
    readyCount: connectors.filter((connector) => connector.enabled && connector.missingEnvironmentVariables.length === 0).length
  };
}

export async function installConnectorPreset(
  repoId: string,
  presetId: string,
  homeDir?: string
): Promise<void> {
  const preset = CONNECTOR_CATALOG.find((item) => item.presetId === presetId);
  if (!preset) throw new Error(`Unknown connector preset: ${presetId}`);
  await upsertConnector(repoId, {
    connectorId: preset.presetId,
    label: preset.label,
    description: preset.description,
    presetId: preset.presetId,
    enabled: true,
    definition: cloneDefinition(preset.definition)
  }, homeDir);
}

export async function upsertConnector(repoId: string, input: ConnectorInput, homeDir?: string): Promise<string> {
  validateDefinition(input.definition);
  const configPath = getConnectorRegistryPath(repoId, homeDir);
  const stored = await readStoredRegistry(configPath);
  const connectorId = sanitizeConnectorId(input.connectorId || input.label);
  if (!connectorId) throw new Error("A connector id or name containing letters or numbers is required.");
  const existing = stored.connectors.find((connector) => connector.connectorId === connectorId);
  const now = new Date().toISOString();
  const next: StoredConnector = {
    connectorId,
    label: input.label.trim(),
    description: input.description?.trim() ?? "Custom MCP server",
    presetId: input.presetId ?? null,
    enabled: input.enabled ?? existing?.enabled ?? true,
    definition: cloneDefinition(input.definition),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  stored.connectors = [...stored.connectors.filter((connector) => connector.connectorId !== connectorId), next]
    .sort((left, right) => left.label.localeCompare(right.label));
  await saveStoredRegistry(configPath, stored);
  return connectorId;
}

export async function setConnectorEnabled(repoId: string, connectorId: string, enabled: boolean, homeDir?: string): Promise<void> {
  const configPath = getConnectorRegistryPath(repoId, homeDir);
  const stored = await readStoredRegistry(configPath);
  const connector = stored.connectors.find((item) => item.connectorId === connectorId);
  if (!connector) throw new Error(`Unknown connector: ${connectorId}`);
  connector.enabled = enabled;
  connector.updatedAt = new Date().toISOString();
  await saveStoredRegistry(configPath, stored);
}

export async function removeConnector(repoId: string, connectorId: string, homeDir?: string): Promise<void> {
  const configPath = getConnectorRegistryPath(repoId, homeDir);
  const stored = await readStoredRegistry(configPath);
  const next = stored.connectors.filter((connector) => connector.connectorId !== connectorId);
  if (next.length === stored.connectors.length) throw new Error(`Unknown connector: ${connectorId}`);
  stored.connectors = next;
  await saveStoredRegistry(configPath, stored);
}

export async function importMcpJson(repoId: string, raw: string, homeDir?: string): Promise<string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid MCP JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error("MCP JSON must be an object.");
  const source = isRecord(parsed.mcpServers) ? parsed.mcpServers : parsed;
  const imported: string[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (!isRecord(value)) continue;
    const definition = parseImportedDefinition(value);
    imported.push(await upsertConnector(repoId, {
      connectorId: name,
      label: humanize(name),
      description: "Imported MCP server",
      definition
    }, homeDir));
  }
  if (imported.length === 0) throw new Error("No MCP server definitions were found. Use an object with an mcpServers property.");
  return imported;
}

export function resolveConnectorRegistry(
  snapshot: ConnectorRegistrySnapshot,
  env: NodeJS.ProcessEnv = process.env
): ResolvedConnectorRegistry {
  const servers: Record<string, ResolvedMcpServerDefinition> = {};
  const missingEnvironment: Record<string, string[]> = {};
  for (const connector of snapshot.connectors) {
    if (!connector.enabled) continue;
    const missing = findMissingEnvironmentVariables(connector.definition, env);
    if (missing.length > 0) {
      missingEnvironment[connector.connectorId] = missing;
      continue;
    }
    servers[connector.connectorId] = resolveDefinition(connector.definition, env);
  }
  return { servers, missingEnvironment };
}

export function findMissingEnvironmentVariables(definition: McpServerDefinition, env: NodeJS.ProcessEnv): string[] {
  const values = [
    definition.url,
    definition.command,
    ...(definition.args ?? []),
    ...Object.values(definition.headers ?? {}),
    ...Object.values(definition.env ?? {}),
    definition.oauth?.clientId,
    definition.oauth?.clientSecret
  ];
  const names = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)) {
      if (!env[match[1]]?.trim()) names.add(match[1]);
    }
  }
  return [...names].sort();
}

function resolveDefinition(definition: McpServerDefinition, env: NodeJS.ProcessEnv): ResolvedMcpServerDefinition {
  const resolve = (value: string) => value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name: string) => env[name] ?? "");
  return {
    ...cloneDefinition(definition),
    url: definition.url ? resolve(definition.url) : undefined,
    command: definition.command ? resolve(definition.command) : undefined,
    args: definition.args?.map(resolve),
    headers: mapValues(definition.headers, resolve),
    env: mapValues(definition.env, resolve),
    oauth: definition.oauth ? {
      clientId: definition.oauth.clientId ? resolve(definition.oauth.clientId) : undefined,
      clientSecret: definition.oauth.clientSecret ? resolve(definition.oauth.clientSecret) : undefined,
      callbackPort: definition.oauth.callbackPort
    } : undefined
  };
}

function parseImportedDefinition(value: Record<string, unknown>): McpServerDefinition {
  const command = stringValue(value.command);
  const url = stringValue(value.url) ?? stringValue(value.serverUrl);
  const explicitType = stringValue(value.type);
  const transport: McpTransport = command ? "stdio" : explicitType === "sse" ? "sse" : "http";
  const definition: McpServerDefinition = {
    transport,
    command,
    url,
    args: stringArray(value.args),
    env: stringRecord(value.env),
    headers: stringRecord(value.headers),
    oauth: parseOAuth(value.oauth),
    timeoutMs: numberValue(value.timeout) ?? numberValue(value.timeoutMs),
    alwaysLoad: typeof value.alwaysLoad === "boolean" ? value.alwaysLoad : undefined
  };
  validateDefinition(definition);
  return definition;
}

function validateDefinition(definition: McpServerDefinition): void {
  if (!(["http", "sse", "stdio"] as string[]).includes(definition.transport)) {
    throw new Error(`Unsupported MCP transport: ${definition.transport}`);
  }
  if (definition.transport === "stdio" && !definition.command?.trim()) {
    throw new Error("A stdio MCP server requires a command.");
  }
  if (definition.transport !== "stdio") {
    if (!definition.url?.trim()) throw new Error("A remote MCP server requires a URL.");
    const interpolated = definition.url.replace(/\$\{[A-Z_][A-Z0-9_]*\}/g, "placeholder");
    try {
      const url = new URL(interpolated);
      if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
        throw new Error("Remote MCP URLs must use HTTPS (localhost HTTP is allowed)." );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("must use HTTPS")) throw error;
      throw new Error("The remote MCP URL is invalid.");
    }
  }
  if (definition.timeoutMs !== undefined && (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs < 1_000)) {
    throw new Error("MCP timeout must be at least 1000 milliseconds.");
  }
}

async function readStoredRegistry(configPath: string): Promise<StoredRegistry> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<StoredRegistry>;
    return { version: 1, connectors: Array.isArray(parsed.connectors) ? parsed.connectors : [] };
  } catch (error) {
    if (isMissingFileError(error)) return { version: 1, connectors: [] };
    throw new Error(`Could not read connector configuration at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function saveStoredRegistry(configPath: string, registry: StoredRegistry): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function parseOAuth(value: unknown): McpOAuthConfig | undefined {
  if (!isRecord(value)) return undefined;
  const oauth = {
    clientId: stringValue(value.clientId),
    clientSecret: stringValue(value.clientSecret),
    callbackPort: numberValue(value.callbackPort)
  };
  return oauth.clientId || oauth.clientSecret || oauth.callbackPort ? oauth : undefined;
}

function mapValues(values: Record<string, string> | undefined, map: (value: string) => string): Record<string, string> | undefined {
  return values ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, map(value)])) : undefined;
}

function clonePreset(preset: ConnectorPreset): ConnectorPreset {
  return { ...preset, definition: cloneDefinition(preset.definition) };
}

function cloneDefinition(definition: McpServerDefinition): McpServerDefinition {
  return JSON.parse(JSON.stringify(definition)) as McpServerDefinition;
}

function sanitizeConnectorId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function humanize(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
