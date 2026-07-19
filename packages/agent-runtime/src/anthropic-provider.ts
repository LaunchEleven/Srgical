import type {
  CanUseTool,
  Options as AnthropicOptions,
  PermissionResult,
  Query,
  SDKMessage
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentEventDraft,
  AgentPermissionMode,
  AgentQuestion
} from "@srgical/studio-shared";
import type {
  AgentPermissionResolution,
  AgentProvider,
  AgentProviderStatus,
  AgentQuestionResolution,
  AgentSessionHandle,
  AgentSessionStartOptions
} from "./provider";

type QueryFactory = (params: { prompt: string; options?: AnthropicOptions }) => QueryLike;

type QueryLike = AsyncIterable<SDKMessage> & Pick<Query, "interrupt" | "setPermissionMode" | "rewindFiles">;

type PendingPermission = {
  toolUseId: string;
  settle(result: PermissionResult): void;
};

type PendingQuestion = {
  toolUseId: string;
  input: Record<string, unknown>;
  settle(result: PermissionResult): void;
};

export type AnthropicAgentProviderOptions = {
  query?: QueryFactory;
  env?: NodeJS.ProcessEnv;
};

const CAPABILITIES: AgentProviderStatus["capabilities"] = [
  "streaming",
  "sessions",
  "resume",
  "fork",
  "interrupt",
  "permissions",
  "questions",
  "tools",
  "tasks",
  "usage",
  "checkpoints",
  "skills"
];

export class AnthropicAgentProvider implements AgentProvider {
  readonly id = "anthropic-agent-sdk";
  readonly label = "Claude Agent SDK";
  readonly #factory?: QueryFactory;
  readonly #env: NodeJS.ProcessEnv;

  constructor(options: AnthropicAgentProviderOptions = {}) {
    this.#factory = options.query;
    this.#env = options.env ?? process.env;
  }

  async detect(): Promise<AgentProviderStatus> {
    try {
      if (!this.#factory) {
        await loadQueryFactory();
      }
      const authentication = detectSupportedAuthentication(this.#env);
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
    const factory = this.#factory ?? await loadQueryFactory();
    const abortController = new AbortController();
    const abort = () => abortController.abort(options.signal.reason);
    if (options.signal.aborted) {
      abort();
    } else {
      options.signal.addEventListener("abort", abort, { once: true });
    }

    let providerSessionId = options.resumeProviderSessionId ?? null;
    const pendingPermissions = new Map<string, PendingPermission>();
    const pendingQuestions = new Map<string, PendingQuestion>();
    const streamedMessages = new Map<string, string>();
    let terminalEventReceived = false;

    const canUseTool: CanUseTool = async (toolName, input, request) => {
      if (toolName === "AskUserQuestion") {
        const questions = parseQuestions(input.questions);
        await options.emit({
          kind: "question.requested",
          payload: { requestId: request.requestId, questions },
          providerPayload: { toolName, input, request }
        });
        await options.emit({ kind: "session.status", payload: { status: "waiting", detail: "Waiting for an answer" } });
        return await new Promise<PermissionResult>((settle, reject) => {
          const onAbort = () => {
            pendingQuestions.delete(request.requestId);
            reject(abortError());
          };
          request.signal.addEventListener("abort", onAbort, { once: true });
          pendingQuestions.set(request.requestId, {
            toolUseId: request.toolUseID,
            input,
            settle: (result) => {
              request.signal.removeEventListener("abort", onAbort);
              settle(result);
            }
          });
        });
      }

      await options.emit({
        kind: "permission.requested",
        payload: {
          requestId: request.requestId,
          toolUseId: request.toolUseID,
          toolName,
          input,
          suggestions: request.suggestions,
          title: request.title ?? request.displayName,
          description: request.description ?? request.decisionReason
        },
        providerPayload: request
      });
      await options.emit({ kind: "session.status", payload: { status: "waiting", detail: `Permission required: ${toolName}` } });
      return await new Promise<PermissionResult>((settle, reject) => {
        const onAbort = () => {
          pendingPermissions.delete(request.requestId);
          reject(abortError());
        };
        request.signal.addEventListener("abort", onAbort, { once: true });
        pendingPermissions.set(request.requestId, {
          toolUseId: request.toolUseID,
          settle: (result) => {
            request.signal.removeEventListener("abort", onAbort);
            settle(result);
          }
        });
      });
    };

    await options.emit({ kind: "session.status", payload: { status: "starting" } });
    const query = factory({
      prompt: options.prompt,
      options: {
        abortController,
        cwd: options.session.workspace,
        canUseTool,
        enableFileCheckpointing: true,
        forkSession: options.fork ?? false,
        includePartialMessages: true,
        permissionMode: toSdkPermissionMode(options.session.permissionMode),
        persistSession: true,
        promptSuggestions: true,
        resume: options.resumeProviderSessionId ?? undefined,
        settingSources: ["user", "project", "local"],
        toolConfig: { askUserQuestion: { previewFormat: "html" } }
      }
    });

    const completion = (async () => {
      try {
        for await (const message of query) {
          if (typeof message.session_id === "string" && message.session_id) {
            providerSessionId = message.session_id;
          }
          if (message.type === "result") {
            terminalEventReceived = true;
          }
          for (const event of mapSdkMessage(message, streamedMessages)) {
            await options.emit(event);
          }
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
        denyPendingRequests(pendingPermissions, pendingQuestions);
      }
    })();

    return {
      get providerSessionId() {
        return providerSessionId;
      },
      completion,
      async interrupt() {
        try {
          await query.interrupt();
        } finally {
          abortController.abort();
        }
      },
      async setPermissionMode(mode) {
        await query.setPermissionMode(toSdkPermissionMode(mode));
      },
      async resolvePermission(requestId, resolution) {
        await resolvePermission(options, pendingPermissions, requestId, resolution);
      },
      async resolveQuestion(requestId, resolution) {
        await resolveQuestion(options, pendingQuestions, requestId, resolution);
      },
      async rewind(checkpointId, dryRun) {
        const result = await query.rewindFiles(checkpointId, { dryRun });
        const changedFiles = result.canRewind ? (result.filesChanged ?? []) : [];
        await options.emit({
          kind: "checkpoint.rewound",
          payload: { checkpointId, changedFiles },
          providerPayload: result
        });
        return { changedFiles };
      }
    };
  }
}

export function detectSupportedAuthentication(env: NodeJS.ProcessEnv): { authenticated: boolean; detail: string } {
  if (env.ANTHROPIC_API_KEY?.trim()) {
    return { authenticated: true, detail: "Claude Console API key configured" };
  }
  if (truthy(env.CLAUDE_CODE_USE_BEDROCK)) {
    return { authenticated: true, detail: "Amazon Bedrock authentication selected" };
  }
  if (truthy(env.CLAUDE_CODE_USE_VERTEX)) {
    return { authenticated: true, detail: "Google Vertex AI authentication selected" };
  }
  if (truthy(env.CLAUDE_CODE_USE_FOUNDRY)) {
    return { authenticated: true, detail: "Microsoft Foundry authentication selected" };
  }
  return {
    authenticated: false,
    detail: "Configure a Claude Console API key or supported cloud provider. Srgical does not reuse Claude subscription OAuth."
  };
}

function mapSdkMessage(message: SDKMessage, streamedMessages: Map<string, string>): AgentEventDraft[] {
  const providerPayload = message;
  if (message.type === "system" && message.subtype === "init") {
    return [{
      kind: "session.started",
      payload: { providerSessionId: message.session_id, model: message.model },
      providerPayload
    }];
  }
  if (message.type === "auth_status") {
    return [{
      kind: "auth.status",
      payload: {
        authenticated: message.error ? false : null,
        authenticating: message.isAuthenticating,
        detail: message.error ?? (message.output.join("\n") || undefined)
      },
      providerPayload
    }];
  }
  if (message.type === "stream_event") {
    return mapStreamEvent(message, streamedMessages);
  }
  if (message.type === "assistant") {
    return mapAssistantMessage(message, streamedMessages);
  }
  if (message.type === "user") {
    return mapToolResults(message);
  }
  if (message.type === "tool_progress") {
    return [{
      kind: "tool.progress",
      payload: {
        toolUseId: message.tool_use_id,
        message: message.heartbeat ? `${message.tool_name} is still running` : `${message.tool_name} is running`,
        elapsedSeconds: message.elapsed_time_seconds
      },
      providerPayload
    }];
  }
  if (message.type === "system" && message.subtype === "permission_denied") {
    return [{
      kind: "tool.failed",
      payload: { toolUseId: message.tool_use_id, message: message.message },
      providerPayload
    }];
  }
  if (message.type === "system" && message.subtype === "task_started") {
    return [{
      kind: "task.started",
      payload: { taskId: message.task_id, subject: message.description, status: "running" },
      providerPayload
    }];
  }
  if (message.type === "system" && message.subtype === "task_progress") {
    return [{
      kind: "task.progress",
      payload: {
        taskId: message.task_id,
        subject: message.description,
        status: "running",
        summary: message.summary ?? message.last_tool_name
      },
      providerPayload
    }];
  }
  if (message.type === "system" && message.subtype === "task_updated") {
    const kind = message.patch.status === "completed" ? "task.completed" : "task.progress";
    return [{
      kind,
      payload: {
        taskId: message.task_id,
        subject: message.patch.description ?? message.task_id,
        status: message.patch.status,
        summary: message.patch.error
      },
      providerPayload
    }];
  }
  if (message.type === "system" && message.subtype === "task_notification") {
    return [{
      kind: "task.completed",
      payload: {
        taskId: message.task_id,
        subject: message.summary || message.task_id,
        status: message.status,
        summary: message.summary
      },
      providerPayload
    }];
  }
  if (message.type === "system" && message.subtype === "files_persisted") {
    return [{
      kind: "files.changed",
      payload: { paths: message.files.map((file) => file.filename) },
      providerPayload
    }];
  }
  if (message.type === "rate_limit_event") {
    return [{
      kind: "rate_limit.updated",
      payload: {
        status: message.rate_limit_info.status,
        resetsAt: message.rate_limit_info.resetsAt
          ? new Date(message.rate_limit_info.resetsAt * 1_000).toISOString()
          : undefined,
        utilization: message.rate_limit_info.utilization
      },
      providerPayload
    }];
  }
  if (message.type === "result") {
    const usage = message.usage as unknown as Record<string, number | undefined>;
    const events: AgentEventDraft[] = [{
      kind: "usage.updated",
      payload: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cachedInputTokens: usage.cache_read_input_tokens,
        costUsd: message.total_cost_usd
      },
      providerPayload
    }];
    if (message.subtype === "success") {
      events.push({ kind: "session.completed", payload: { result: message.result }, providerPayload });
    } else {
      events.push({
        kind: "session.failed",
        payload: { message: message.errors.join("\n") || message.subtype, code: message.subtype },
        providerPayload
      });
    }
    return events;
  }
  return [];
}

function mapStreamEvent(
  message: Extract<SDKMessage, { type: "stream_event" }>,
  streamedMessages: Map<string, string>
): AgentEventDraft[] {
  const event = message.event as unknown as Record<string, unknown>;
  const messageId = message.uuid;
  if (event.type === "message_start") {
    streamedMessages.set(messageId, "");
    return [{ kind: "message.started", payload: { messageId, role: "assistant" }, providerPayload: message }];
  }
  const delta = isRecord(event.delta) ? event.delta : null;
  if (event.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
    const previous = streamedMessages.get(messageId) ?? "";
    streamedMessages.set(messageId, previous + delta.text);
    return [{ kind: "message.delta", payload: { messageId, text: delta.text }, providerPayload: message }];
  }
  if (event.type === "message_stop") {
    const text = streamedMessages.get(messageId) ?? "";
    return [{ kind: "message.completed", payload: { messageId, text }, providerPayload: message }];
  }
  return [];
}

function mapAssistantMessage(
  message: Extract<SDKMessage, { type: "assistant" }>,
  streamedMessages: Map<string, string>
): AgentEventDraft[] {
  const content = Array.isArray(message.message.content) ? message.message.content : [];
  const events: AgentEventDraft[] = [];
  const text = content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!streamedMessages.has(message.uuid) && text) {
    events.push({ kind: "message.started", payload: { messageId: message.uuid, role: "assistant" }, providerPayload: message });
    events.push({ kind: "message.completed", payload: { messageId: message.uuid, text }, providerPayload: message });
  }
  for (const block of content) {
    if (block.type === "tool_use") {
      events.push({
        kind: "tool.started",
        payload: {
          toolUseId: block.id,
          toolName: block.name,
          input: block.input,
          parentToolUseId: message.parent_tool_use_id
        },
        providerPayload: message
      });
    }
  }
  return events;
}

function mapToolResults(message: Extract<SDKMessage, { type: "user" }>): AgentEventDraft[] {
  const content = Array.isArray(message.message.content) ? message.message.content : [];
  const events: AgentEventDraft[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null || !("type" in block) || block.type !== "tool_result" || !("tool_use_id" in block)) {
      continue;
    }
    const toolUseId = String(block.tool_use_id);
    if ("is_error" in block && block.is_error) {
      events.push({ kind: "tool.failed", payload: { toolUseId, message: stringifyContent(block.content) }, providerPayload: message });
    } else {
      events.push({ kind: "tool.completed", payload: { toolUseId, output: message.tool_use_result ?? block.content }, providerPayload: message });
    }
  }
  return events;
}

async function resolvePermission(
  options: AgentSessionStartOptions,
  pending: Map<string, PendingPermission>,
  requestId: string,
  resolution: AgentPermissionResolution
): Promise<void> {
  const request = pending.get(requestId);
  if (!request) throw new Error(`Unknown permission request: ${requestId}`);
  if (resolution.behavior === "defer") return;
  pending.delete(requestId);
  request.settle(resolution.behavior === "allow"
    ? { behavior: "allow", updatedInput: asRecord(resolution.updatedInput), toolUseID: request.toolUseId }
    : { behavior: "deny", message: resolution.message ?? "Denied by user", toolUseID: request.toolUseId });
  await options.emit({
    kind: "permission.resolved",
    payload: { requestId, behavior: resolution.behavior, message: resolution.message }
  });
  await options.emit({ kind: "session.status", payload: { status: "running" } });
}

async function resolveQuestion(
  options: AgentSessionStartOptions,
  pending: Map<string, PendingQuestion>,
  requestId: string,
  resolution: AgentQuestionResolution
): Promise<void> {
  const request = pending.get(requestId);
  if (!request) throw new Error(`Unknown question request: ${requestId}`);
  pending.delete(requestId);
  request.settle({
    behavior: "allow",
    updatedInput: { ...request.input, answers: resolution.answers },
    toolUseID: request.toolUseId
  });
  await options.emit({ kind: "question.resolved", payload: { requestId, answers: resolution.answers } });
  await options.emit({ kind: "session.status", payload: { status: "running" } });
}

function denyPendingRequests(
  permissions: Map<string, PendingPermission>,
  questions: Map<string, PendingQuestion>
): void {
  for (const request of permissions.values()) {
    request.settle({ behavior: "deny", message: "Session ended", toolUseID: request.toolUseId });
  }
  for (const request of questions.values()) {
    request.settle({ behavior: "deny", message: "Session ended", toolUseID: request.toolUseId });
  }
  permissions.clear();
  questions.clear();
}

function parseQuestions(value: unknown): AgentQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((question) => ({
    question: typeof question.question === "string" ? question.question : "Question",
    header: typeof question.header === "string" ? question.header : "Input",
    multiSelect: question.multiSelect === true,
    options: Array.isArray(question.options)
      ? question.options.filter(isRecord).map((option) => ({
        label: typeof option.label === "string" ? option.label : "Option",
        description: typeof option.description === "string" ? option.description : "",
        preview: typeof option.preview === "string" ? option.preview : undefined
      }))
      : []
  }));
}

function toSdkPermissionMode(mode: AgentPermissionMode): AgentPermissionMode {
  return mode;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function abortError(): Error {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadQueryFactory(): Promise<QueryFactory> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{
    query: QueryFactory;
  }>;
  const sdk = await dynamicImport("@anthropic-ai/claude-agent-sdk");
  return sdk.query;
}
