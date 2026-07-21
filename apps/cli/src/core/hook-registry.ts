import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HookDefinition, HookHandler, HookRegistrySnapshot, HookTrigger, HookUpsertInput } from "@srgical/studio-shared";

type StoredHookRegistry = {
  version: 1;
  hooks: HookDefinition[];
};

export function getHookRegistryPath(repoId: string, homeDir = os.homedir()): string {
  return path.join(homeDir, ".srgical", "repos", sanitizeRepoId(repoId), "hooks.json");
}

export async function loadHookRegistry(repoId: string, homeDir?: string): Promise<HookRegistrySnapshot> {
  const registryPath = getHookRegistryPath(repoId, homeDir);
  try {
    const parsed = JSON.parse(await readFile(registryPath, "utf8")) as Partial<StoredHookRegistry>;
    const hooks = Array.isArray(parsed.hooks)
      ? parsed.hooks.map(normalizeHook).filter((item): item is HookDefinition => item !== null)
      : [];
    return { hooks: sortHooks(hooks) };
  } catch (error) {
    if (isMissingFileError(error)) return { hooks: [] };
    throw new Error(`Could not read hook registry at ${registryPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function upsertHook(repoId: string, input: HookUpsertInput, homeDir?: string): Promise<HookRegistrySnapshot> {
  const existing = await loadHookRegistry(repoId, homeDir);
  const now = new Date().toISOString();
  const hookId = sanitizeHookId(input.hookId?.trim() || input.label);
  if (!hookId) throw new Error("A hook id or label is required.");
  const previous = existing.hooks.find((hook) => hook.hookId === hookId);
  const hook: HookDefinition = {
    hookId,
    label: requireText(input.label, "A hook label is required."),
    description: input.description?.trim() ?? "",
    trigger: normalizeTrigger(input.trigger),
    handler: normalizeHandler(input.handler),
    instruction: requireText(input.instruction, "A hook instruction is required."),
    enabled: input.enabled !== false,
    blocking: input.blocking === true,
    priority: normalizeInteger(input.priority, 100, 0, 10_000),
    timeoutMs: normalizeInteger(input.timeoutMs, 15_000, 250, 120_000),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  };
  return saveHookRegistry(repoId, {
    hooks: [...existing.hooks.filter((item) => item.hookId !== hookId), hook]
  }, homeDir);
}

export async function setHookEnabled(repoId: string, hookId: string, enabled: boolean, homeDir?: string): Promise<HookRegistrySnapshot> {
  const existing = await loadHookRegistry(repoId, homeDir);
  const target = existing.hooks.find((hook) => hook.hookId === hookId);
  if (!target) throw new Error(`Unknown hook: ${hookId}`);
  return saveHookRegistry(repoId, {
    hooks: existing.hooks.map((hook) => hook.hookId === hookId ? { ...hook, enabled, updatedAt: new Date().toISOString() } : hook)
  }, homeDir);
}

export async function removeHook(repoId: string, hookId: string, homeDir?: string): Promise<HookRegistrySnapshot> {
  const existing = await loadHookRegistry(repoId, homeDir);
  return saveHookRegistry(repoId, { hooks: existing.hooks.filter((hook) => hook.hookId !== hookId) }, homeDir);
}

async function saveHookRegistry(repoId: string, snapshot: HookRegistrySnapshot, homeDir?: string): Promise<HookRegistrySnapshot> {
  const normalized = { hooks: sortHooks(snapshot.hooks) };
  const registryPath = getHookRegistryPath(repoId, homeDir);
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify({ version: 1, hooks: normalized.hooks } satisfies StoredHookRegistry, null, 2)}\n`, "utf8");
  return normalized;
}

function normalizeHook(value: unknown): HookDefinition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<HookDefinition>;
  try {
    const now = new Date().toISOString();
    return {
      hookId: sanitizeHookId(requireText(candidate.hookId, "")),
      label: requireText(candidate.label, ""),
      description: typeof candidate.description === "string" ? candidate.description.trim() : "",
      trigger: normalizeTrigger(candidate.trigger),
      handler: normalizeHandler(candidate.handler),
      instruction: requireText(candidate.instruction, ""),
      enabled: candidate.enabled !== false,
      blocking: candidate.blocking === true,
      priority: normalizeInteger(candidate.priority, 100, 0, 10_000),
      timeoutMs: normalizeInteger(candidate.timeoutMs, 15_000, 250, 120_000),
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : now
    };
  } catch {
    return null;
  }
}

function normalizeHandler(value: unknown): HookHandler {
  if (!value || typeof value !== "object") throw new Error("A hook handler is required.");
  const candidate = value as Partial<HookHandler> & { type?: unknown; skillId?: unknown; connectorId?: unknown; toolName?: unknown };
  if (candidate.type === "skill") {
    return { type: "skill", skillId: requireText(candidate.skillId, "A skill hook requires a skill.") };
  }
  if (candidate.type === "mcp") {
    return {
      type: "mcp",
      connectorId: requireText(candidate.connectorId, "An MCP hook requires a connector."),
      toolName: requireText(candidate.toolName, "An MCP hook requires a tool name.")
    };
  }
  throw new Error("Hook handlers must use a skill or MCP connector.");
}

function normalizeTrigger(value: unknown): HookTrigger {
  if (value === "turn.received" || value === "turn.completed") return value;
  throw new Error("Hook trigger must be turn.received or turn.completed.");
}

function normalizeInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(minimum, Math.min(maximum, candidate));
}

function requireText(value: unknown, message: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(message || "A required hook field is missing.");
}

function sanitizeHookId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function sanitizeRepoId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function sortHooks(hooks: HookDefinition[]): HookDefinition[] {
  return [...hooks].sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label));
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
