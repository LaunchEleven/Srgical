import { randomUUID } from "node:crypto";
import type {
  AgentEventDraft,
  ConnectorRegistrySnapshot,
  HookDefinition,
  HookTrigger,
  SkillRegistrySnapshot
} from "@srgical/studio-shared";

export type PreparedHookExecution = {
  executionId: string;
  hook: HookDefinition;
  promptBlock: string;
  completionSummary: string;
  expectedToolName: string | null;
};

export type PrepareTurnHooksOptions = {
  hooks: HookDefinition[];
  trigger: HookTrigger;
  userMessage: string;
  skills: SkillRegistrySnapshot;
  connectors: ConnectorRegistrySnapshot;
  mcpAvailable: boolean;
  emit(event: AgentEventDraft): Promise<void>;
};

export async function prepareTurnHooks(options: PrepareTurnHooksOptions): Promise<PreparedHookExecution[]> {
  const prepared: PreparedHookExecution[] = [];
  const hooks = options.hooks
    .filter((hook) => hook.enabled && hook.trigger === options.trigger)
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label));

  for (const hook of hooks) {
    const executionId = randomUUID();
    await options.emit({
      kind: "hook.started",
      payload: {
        executionId,
        hookId: hook.hookId,
        label: hook.label,
        trigger: hook.trigger,
        handlerType: hook.handler.type
      }
    });
    try {
      const directive = buildHookDirective(hook, options.userMessage, options.skills, options.connectors, options.mcpAvailable);
      prepared.push({ executionId, hook, ...directive });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await options.emit({
        kind: "hook.failed",
        payload: {
          executionId,
          hookId: hook.hookId,
          label: hook.label,
          trigger: hook.trigger,
          message,
          blocking: hook.blocking
        }
      });
      if (hook.blocking) throw new Error(`Blocking hook \`${hook.label}\` failed: ${message}`);
    }
  }
  return prepared;
}

export async function completeTurnHooks(
  executions: PreparedHookExecution[],
  emit: (event: AgentEventDraft) => Promise<void>,
  options: { observedToolNames?: string[]; validationOnly?: boolean } = {}
): Promise<void> {
  for (const execution of executions) {
    if (execution.expectedToolName && !options.validationOnly && !hasObservedTool(options.observedToolNames ?? [], execution.expectedToolName)) {
      await emit({
        kind: "hook.failed",
        payload: {
          executionId: execution.executionId,
          hookId: execution.hook.hookId,
          label: execution.hook.label,
          trigger: execution.hook.trigger,
          message: `The agent turn completed without calling MCP tool \`${execution.expectedToolName}\`.`,
          blocking: execution.hook.blocking
        }
      });
      continue;
    }
    await emit({
      kind: "hook.completed",
      payload: {
        executionId: execution.executionId,
        hookId: execution.hook.hookId,
        label: execution.hook.label,
        trigger: execution.hook.trigger,
        summary: options.validationOnly ? "Hook configuration validated." : execution.completionSummary
      }
    });
  }
}

export async function failTurnHooks(executions: PreparedHookExecution[], message: string, emit: (event: AgentEventDraft) => Promise<void>): Promise<void> {
  for (const execution of executions) {
    await emit({
      kind: "hook.failed",
      payload: {
        executionId: execution.executionId,
        hookId: execution.hook.hookId,
        label: execution.hook.label,
        trigger: execution.hook.trigger,
        message,
        blocking: execution.hook.blocking
      }
    });
  }
}

function buildHookDirective(
  hook: HookDefinition,
  userMessage: string,
  skills: SkillRegistrySnapshot,
  connectors: ConnectorRegistrySnapshot,
  mcpAvailable: boolean
): Pick<PreparedHookExecution, "promptBlock" | "completionSummary" | "expectedToolName"> {
  const timing = hook.trigger === "turn.received"
    ? "Run this hook before answering the user's request."
    : "Run this hook after the primary task and before finalizing the response.";
  const handler = hook.handler;
  if (handler.type === "skill") {
    const skill = skills.skills.find((item) => item.id === handler.skillId && item.effective);
    if (!skill) throw new Error(`Effective skill \`${handler.skillId}\` is unavailable.`);
    return {
      promptBlock: [
        `Hook: ${hook.label} (${hook.trigger})`,
        timing,
        `Read and follow the complete \`${skill.name}\` skill at: ${skill.manifestPath}`,
        `Hook instruction: ${hook.instruction}`,
        `Current user message: ${userMessage}`
      ].join("\n"),
      completionSummary: `Applied the ${skill.name} skill to the turn.`,
      expectedToolName: null
    };
  }

  if (!mcpAvailable) throw new Error("MCP hooks require an active native provider with connector support.");
  const connector = connectors.connectors.find((item) => item.connectorId === handler.connectorId);
  if (!connector?.enabled) throw new Error(`Enabled connector \`${handler.connectorId}\` is unavailable.`);
  if (connector.missingEnvironmentVariables.length) {
    throw new Error(`Connector \`${connector.label}\` is missing: ${connector.missingEnvironmentVariables.join(", ")}.`);
  }
  if (connector.tools.length && !connector.tools.some((tool) => tool.name === handler.toolName)) {
    throw new Error(`Connector \`${connector.label}\` does not expose tool \`${handler.toolName}\`.`);
  }
  return {
    promptBlock: [
      `Hook: ${hook.label} (${hook.trigger})`,
      timing,
      `Use MCP connector \`${connector.label}\` and call tool \`${handler.toolName}\`.`,
      `Hook instruction: ${hook.instruction}`,
      `Current user message: ${userMessage}`,
      "Make the hook's result traceable in the response, but do not expose secrets or raw credentials."
    ].join("\n"),
    completionSummary: `Applied ${connector.label}.${handler.toolName} to the turn.`,
    expectedToolName: handler.toolName
  };
}

function hasObservedTool(observed: string[], expected: string): boolean {
  const normalizedExpected = expected.toLowerCase();
  return observed.some((name) => {
    const normalized = name.toLowerCase();
    return normalized === normalizedExpected
      || normalized.endsWith(`__${normalizedExpected}`)
      || normalized.endsWith(`.${normalizedExpected}`)
      || normalized.endsWith(`/${normalizedExpected}`);
  });
}
