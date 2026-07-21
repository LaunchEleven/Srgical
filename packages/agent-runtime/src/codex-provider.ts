import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import type {
  CodexOptions,
  ThreadEvent,
  ThreadOptions
} from "@openai/codex-sdk";
import type {
  AgentEventDraft,
  AgentPermissionMode,
  ResolvedMcpServerDefinition
} from "@srgical/studio-shared";
import type {
  AgentProvider,
  AgentModelCatalog,
  AgentModelListOptions,
  AgentProviderStatus,
  AgentSessionHandle,
  AgentSessionStartOptions
} from "./provider";

type CodexThreadLike = {
  readonly id: string | null;
  runStreamed(input: string, options?: { signal?: AbortSignal }): Promise<{ events: AsyncIterable<ThreadEvent> }>;
};

type CodexClientLike = {
  startThread(options?: ThreadOptions): CodexThreadLike;
  resumeThread(id: string, options?: ThreadOptions): CodexThreadLike;
};

type CodexFactory = (options?: CodexOptions) => CodexClientLike;

export type CodexAgentProviderOptions = {
  createCodex?: CodexFactory;
  listModels?: (options: AgentModelListOptions) => Promise<AgentModelCatalog>;
  env?: NodeJS.ProcessEnv;
  authFilePath?: string;
  authMethod?: CodexAuthMethod;
};

export type CodexAuthMethod = "auto" | "chatgpt" | "api-key";

const CAPABILITIES: AgentProviderStatus["capabilities"] = [
  "streaming",
  "sessions",
  "resume",
  "interrupt",
  "tools",
  "tasks",
  "usage",
  "skills",
  "mcp"
];

export class CodexAgentProvider implements AgentProvider {
  readonly id: string;
  readonly label: string;
  readonly #factory?: CodexFactory;
  readonly #listModels?: (options: AgentModelListOptions) => Promise<AgentModelCatalog>;
  readonly #env: NodeJS.ProcessEnv;
  readonly #authFilePath: string;
  readonly #authMethod: CodexAuthMethod;

  constructor(options: CodexAgentProviderOptions = {}) {
    this.#factory = options.createCodex;
    this.#listModels = options.listModels;
    this.#env = options.env ?? process.env;
    const codexHome = this.#env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
    this.#authFilePath = options.authFilePath ?? path.join(codexHome, "auth.json");
    this.#authMethod = options.authMethod ?? "auto";
    this.id = this.#authMethod === "chatgpt"
      ? "codex-sdk:chatgpt"
      : this.#authMethod === "api-key"
        ? "codex-sdk:api-key"
        : "codex-sdk";
    this.label = this.#authMethod === "chatgpt"
      ? "Codex · ChatGPT subscription"
      : this.#authMethod === "api-key"
        ? "Codex · API key"
        : "Codex";
  }

  async listModels(options: AgentModelListOptions): Promise<AgentModelCatalog> {
    if (this.#listModels) return this.#listModels(options);
    return queryCodexModelCatalog({
      ...options,
      env: buildCodexProviderEnvironment(this.#env, this.#authMethod)
    });
  }

  async detect(): Promise<AgentProviderStatus> {
    try {
      const factory = this.#factory ?? await loadCodexFactory();
      factory();
      const authentication = await detectCodexAuthentication(this.#env, this.#authFilePath, this.#authMethod);
      return {
        providerId: this.id,
        label: this.label,
        available: true,
        authenticated: authentication.authenticated,
        capabilities: [...CAPABILITIES],
        detail: authentication.detail
      };
    } catch (error) {
      return {
        providerId: this.id,
        label: this.label,
        available: false,
        authenticated: null,
        capabilities: [],
        detail: errorMessage(error)
      };
    }
  }

  async start(options: AgentSessionStartOptions): Promise<AgentSessionHandle> {
    const factory = this.#factory ?? await loadCodexFactory();
    const abortController = new AbortController();
    const abort = () => abortController.abort(options.signal.reason);
    if (options.signal.aborted) abort();
    else options.signal.addEventListener("abort", abort, { once: true });

    const providerEnv = buildCodexProviderEnvironment(this.#env, this.#authMethod);
    const mcp = toCodexMcpConfiguration(options.mcpServers ?? {}, providerEnv);
    const client = factory({ config: mcp.config, env: mcp.env });
    const threadOptions: ThreadOptions = {
      workingDirectory: options.session.workspace,
      model: options.session.model ?? undefined,
      skipGitRepoCheck: true,
      sandboxMode: toCodexSandboxMode(options.session.permissionMode),
      approvalPolicy: toCodexApprovalPolicy(options.session.permissionMode)
    };
    const thread = options.resumeProviderSessionId
      ? client.resumeThread(options.resumeProviderSessionId, threadOptions)
      : client.startThread(threadOptions);
    let providerSessionId = options.resumeProviderSessionId ?? null;
    let terminalEventReceived = false;

    await options.emit({ kind: "session.status", payload: { status: "starting" } });
    const streamed = await thread.runStreamed(options.prompt, { signal: abortController.signal });
    const completion = (async () => {
      try {
        for await (const event of streamed.events) {
          if (event.type === "thread.started") providerSessionId = event.thread_id;
          if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "error") {
            terminalEventReceived = true;
          }
          for (const mapped of mapCodexEvent(event)) await options.emit(mapped);
        }
        if (!terminalEventReceived && !abortController.signal.aborted) {
          await options.emit({ kind: "session.completed", payload: {} });
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          await options.emit({ kind: "session.status", payload: { status: "interrupted" } });
        } else {
          await options.emit({ kind: "session.failed", payload: { message: errorMessage(error) } });
        }
      } finally {
        options.signal.removeEventListener("abort", abort);
      }
    })();

    return {
      get providerSessionId() {
        return providerSessionId ?? thread.id;
      },
      completion,
      async interrupt() {
        abortController.abort();
      }
    };
  }
}

export async function detectCodexAuthentication(
  env: NodeJS.ProcessEnv,
  authFilePath = path.join(env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"), "auth.json"),
  authMethod: CodexAuthMethod = "auto"
): Promise<{ authenticated: boolean; detail: string }> {
  if (authMethod === "api-key") {
    const keyName = env.CODEX_API_KEY?.trim()
      ? "CODEX_API_KEY"
      : env.OPENAI_API_KEY?.trim()
        ? "OPENAI_API_KEY"
        : null;
    return keyName
      ? { authenticated: true, detail: `${keyName} is ready for Codex API billing` }
      : { authenticated: false, detail: "Set CODEX_API_KEY or OPENAI_API_KEY to use API billing." };
  }

  try {
    const parsed = JSON.parse(await readFile(authFilePath, "utf8")) as { auth_mode?: unknown; tokens?: unknown };
    if (parsed.auth_mode === "chatgpt" && parsed.tokens) {
      return { authenticated: true, detail: "Signed in with ChatGPT; Codex plan usage is available" };
    }
    if (authMethod === "chatgpt") {
      return { authenticated: false, detail: "Run `codex login` and choose Sign in with ChatGPT." };
    }
  } catch {
    if (authMethod === "chatgpt") {
      return { authenticated: false, detail: "Run `codex login` and choose Sign in with ChatGPT." };
    }
  }


  if (env.CODEX_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()) {
    return { authenticated: true, detail: "Codex API key configured" };
  }
  return { authenticated: false, detail: "Run `codex login` or configure a Codex API key." };
}

export function buildCodexProviderEnvironment(
  sourceEnv: NodeJS.ProcessEnv,
  authMethod: CodexAuthMethod
): NodeJS.ProcessEnv {
  const env = { ...sourceEnv };
  if (authMethod === "chatgpt") {
    delete env.CODEX_API_KEY;
    delete env.OPENAI_API_KEY;
  } else if (authMethod === "api-key") {
    const apiKey = env.CODEX_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
    delete env.OPENAI_API_KEY;
    if (apiKey) env.CODEX_API_KEY = apiKey;
  }
  return env;
}

export function toCodexMcpConfiguration(
  servers: Record<string, ResolvedMcpServerDefinition>,
  sourceEnv: NodeJS.ProcessEnv = process.env
): { config: NonNullable<CodexOptions["config"]>; env: Record<string, string> } {
  const env = Object.fromEntries(
    Object.entries(sourceEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
  const mcpServers: Record<string, NonNullable<CodexOptions["config"]>> = {};
  let callbackPort: number | undefined;

  for (const [name, definition] of Object.entries(servers)) {
    const timeoutSeconds = definition.timeoutMs ? Math.max(1, Math.ceil(definition.timeoutMs / 1_000)) : undefined;
    if (definition.transport === "stdio") {
      const forwardedEnvironment = Object.entries(definition.env ?? {});
      for (const [key, value] of forwardedEnvironment) env[key] = value;
      const config: NonNullable<CodexOptions["config"]> = {
        command: definition.command ?? "",
        ...(definition.args ? { args: definition.args } : {}),
        ...(forwardedEnvironment.length > 0 ? { env_vars: forwardedEnvironment.map(([key]) => key) } : {}),
        ...(timeoutSeconds ? { startup_timeout_sec: timeoutSeconds, tool_timeout_sec: timeoutSeconds } : {})
      };
      mcpServers[name] = config;
      continue;
    }

    const config: NonNullable<CodexOptions["config"]> = {
      url: definition.url ?? "",
      ...(timeoutSeconds ? { startup_timeout_sec: timeoutSeconds, tool_timeout_sec: timeoutSeconds } : {})
    };
    const envHeaders: Record<string, string> = {};
    for (const [index, [header, value]] of Object.entries(definition.headers ?? {}).entries()) {
      const variable = `SRGICAL_MCP_${sanitizeEnvironmentPart(name)}_${sanitizeEnvironmentPart(header)}_${index}`;
      env[variable] = value;
      const bearer = header.toLowerCase() === "authorization" && /^Bearer\s+(.+)$/i.test(value);
      if (bearer) {
        env[variable] = value.replace(/^Bearer\s+/i, "");
        config.bearer_token_env_var = variable;
      } else {
        envHeaders[header] = variable;
      }
    }
    if (Object.keys(envHeaders).length > 0) config.env_http_headers = envHeaders;
    mcpServers[name] = config;
    callbackPort ??= definition.oauth?.callbackPort;
  }

  return {
    config: {
      mcp_servers: mcpServers,
      ...(callbackPort ? { mcp_oauth_callback_port: callbackPort } : {})
    },
    env
  };
}

export function mapCodexEvent(event: ThreadEvent): AgentEventDraft[] {
  const providerPayload = event;
  if (event.type === "thread.started") {
    return [{ kind: "session.started", payload: { providerSessionId: event.thread_id }, providerPayload }];
  }
  if (event.type === "turn.started") {
    return [{ kind: "session.status", payload: { status: "running" }, providerPayload }];
  }
  if (event.type === "turn.completed") {
    return [
      {
        kind: "usage.updated",
        payload: {
          inputTokens: event.usage.input_tokens,
          outputTokens: event.usage.output_tokens,
          cachedInputTokens: event.usage.cached_input_tokens
        },
        providerPayload
      },
      { kind: "session.completed", payload: {}, providerPayload }
    ];
  }
  if (event.type === "turn.failed") {
    return [{ kind: "session.failed", payload: { message: event.error.message }, providerPayload }];
  }
  if (event.type === "error") {
    return [{ kind: "session.failed", payload: { message: event.message }, providerPayload }];
  }
  return mapCodexItem(event.type, event.item, providerPayload);
}

function mapCodexItem(
  phase: "item.started" | "item.updated" | "item.completed",
  item: Extract<ThreadEvent, { type: "item.started" | "item.updated" | "item.completed" }>["item"],
  providerPayload: ThreadEvent
): AgentEventDraft[] {
  if (item.type === "agent_message" && phase === "item.completed") {
    return [
      { kind: "message.started", payload: { messageId: item.id, role: "assistant" }, providerPayload },
      { kind: "message.delta", payload: { messageId: item.id, text: item.text }, providerPayload },
      { kind: "message.completed", payload: { messageId: item.id, text: item.text }, providerPayload }
    ];
  }
  if (item.type === "command_execution") {
    if (phase === "item.started") {
      return [{ kind: "tool.started", payload: { toolUseId: item.id, toolName: "Shell", input: { command: item.command } }, providerPayload }];
    }
    if (phase === "item.updated") {
      return [{ kind: "tool.progress", payload: { toolUseId: item.id, message: item.aggregated_output || item.command }, providerPayload }];
    }
    return item.status === "failed"
      ? [{ kind: "tool.failed", payload: { toolUseId: item.id, message: item.aggregated_output || `Command exited ${item.exit_code ?? "with an error"}` }, providerPayload }]
      : [{ kind: "tool.completed", payload: { toolUseId: item.id, output: item.aggregated_output }, providerPayload }];
  }
  if (item.type === "file_change") {
    if (phase === "item.started") {
      return [{ kind: "tool.started", payload: { toolUseId: item.id, toolName: "File change", input: item.changes }, providerPayload }];
    }
    if (phase !== "item.completed") return [];
    const paths = item.changes.map((change) => change.path);
    return item.status === "failed"
      ? [{ kind: "tool.failed", payload: { toolUseId: item.id, message: "Codex could not apply the file change." }, providerPayload }]
      : [
          { kind: "tool.completed", payload: { toolUseId: item.id, changedFiles: paths }, providerPayload },
          { kind: "files.changed", payload: { paths }, providerPayload }
        ];
  }
  if (item.type === "mcp_tool_call") {
    const toolName = `${item.server}/${item.tool}`;
    if (phase === "item.started") {
      return [{ kind: "tool.started", payload: { toolUseId: item.id, toolName, input: item.arguments }, providerPayload }];
    }
    if (phase === "item.updated") {
      return [{ kind: "tool.progress", payload: { toolUseId: item.id, message: `${toolName} is running` }, providerPayload }];
    }
    return item.status === "failed"
      ? [{ kind: "tool.failed", payload: { toolUseId: item.id, message: item.error?.message ?? `${toolName} failed` }, providerPayload }]
      : [{ kind: "tool.completed", payload: { toolUseId: item.id, output: item.result }, providerPayload }];
  }
  if (item.type === "web_search") {
    if (phase === "item.started") {
      return [{ kind: "tool.started", payload: { toolUseId: item.id, toolName: "Web search", input: { query: item.query } }, providerPayload }];
    }
    return phase === "item.completed"
      ? [{ kind: "tool.completed", payload: { toolUseId: item.id }, providerPayload }]
      : [];
  }
  if (item.type === "todo_list") {
    const kind = phase === "item.completed" ? "task.completed" : phase === "item.started" ? "task.started" : "task.progress";
    return item.items.map((todo, index) => ({
      kind,
      payload: {
        taskId: `${item.id}:${index}`,
        subject: todo.text,
        status: todo.completed ? "completed" : "pending"
      },
      providerPayload
    })) as AgentEventDraft[];
  }
  if (item.type === "error" && phase === "item.completed") {
    return [{ kind: "tool.failed", payload: { toolUseId: item.id, message: item.message }, providerPayload }];
  }
  return [];
}

function toCodexSandboxMode(mode: AgentPermissionMode): ThreadOptions["sandboxMode"] {
  if (mode === "bypassPermissions") return "danger-full-access";
  if (mode === "acceptEdits" || mode === "auto") return "workspace-write";
  return "read-only";
}

function toCodexApprovalPolicy(mode: AgentPermissionMode): ThreadOptions["approvalPolicy"] {
  return mode === "dontAsk" || mode === "auto" || mode === "bypassPermissions" ? "never" : "on-request";
}

function sanitizeEnvironmentPart(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "VALUE";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type CodexAppServerModel = {
  id?: unknown;
  model?: unknown;
  displayName?: unknown;
  description?: unknown;
  hidden?: unknown;
  isDefault?: unknown;
};

export function toCodexModelCatalog(rows: CodexAppServerModel[]): AgentModelCatalog {
  const models = rows
    .filter((row) => row.hidden !== true)
    .map((row) => {
      const id = typeof row.model === "string" && row.model.trim()
        ? row.model.trim()
        : typeof row.id === "string"
          ? row.id.trim()
          : "";
      return {
        id,
        label: typeof row.displayName === "string" && row.displayName.trim() ? row.displayName.trim() : id,
        description: typeof row.description === "string" ? row.description.trim() : "",
        resolvedId: id,
        isDefault: row.isDefault === true
      };
    })
    .filter((model) => model.id.length > 0)
    .filter((model, index, all) => all.findIndex((candidate) => candidate.id === model.id) === index);
  return {
    models,
    defaultModelId: models.find((model) => model.isDefault)?.id ?? null
  };
}

export async function queryCodexModelCatalog(options: AgentModelListOptions & {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<AgentModelCatalog> {
  const codexEntrypoint = require.resolve("@openai/codex/bin/codex.js");
  const child = spawn(process.execPath, [codexEntrypoint, "app-server"], {
    cwd: options.workspace,
    env: options.env ?? process.env,
    stdio: "pipe",
    windowsHide: true
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  let settled = false;

  return new Promise<AgentModelCatalog>((resolve, reject) => {
    const finish = (error?: Error, catalog?: AgentModelCatalog) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      lines.close();
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(catalog ?? { models: [], defaultModelId: null });
    };
    const onAbort = () => finish(abortError(options.signal?.reason));
    const timeout = setTimeout(() => finish(new Error("Timed out while asking Codex for its available models.")), options.timeoutMs ?? 12_000);

    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2_000);
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex model discovery exited with code ${code ?? "unknown"}.`));
    });
    lines.on("line", (line) => {
      let message: { id?: unknown; result?: unknown; error?: { message?: unknown } };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.error) {
          finish(new Error(typeof message.error.message === "string" ? message.error.message : "Codex initialization failed."));
          return;
        }
        child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
        child.stdin.write(`${JSON.stringify({ method: "model/list", id: 2, params: { limit: 100, includeHidden: false } })}\n`);
        return;
      }
      if (message.id === 2) {
        if (message.error) {
          finish(new Error(typeof message.error.message === "string" ? message.error.message : "Codex model discovery failed."));
          return;
        }
        const result = isRecord(message.result) ? message.result : {};
        const rows = Array.isArray(result.data) ? result.data.filter(isRecord) : [];
        finish(undefined, toCodexModelCatalog(rows));
      }
    });

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    child.stdin.write(`${JSON.stringify({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "srgical", title: "Srgical", version: "0.0.0" },
        capabilities: null
      }
    })}\n`);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortError(reason: unknown): Error {
  const error = new Error(typeof reason === "string" ? reason : "Model discovery was interrupted.");
  error.name = "AbortError";
  return error;
}

async function loadCodexFactory(): Promise<CodexFactory> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{
    Codex: new (options?: CodexOptions) => CodexClientLike;
  }>;
  const sdk = await dynamicImport("@openai/codex-sdk");
  return (options) => new sdk.Codex(options);
}
