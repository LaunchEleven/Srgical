import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentEvent,
  AgentEventDraft,
  AgentEventKind,
  AgentSessionRecord,
  AgentSessionStatus,
  AgentSessionWorkspaceBinding
} from "@srgical/studio-shared";

export type CreateAgentSessionInput = Pick<
  AgentSessionRecord,
  | "providerId"
  | "repoId"
  | "laneId"
  | "workspace"
  | "planId"
  | "title"
  | "model"
  | "permissionMode"
  | "capabilities"
  | "effectiveSkillHashes"
> & {
  sessionId?: string;
  providerSessionId?: string | null;
  status?: AgentSessionStatus;
  parentSessionId?: string | null;
  branchName?: string | null;
  startingCommit?: string | null;
};

export type AgentSessionStoreOptions = {
  homeDir?: string;
  now?: () => string;
  createId?: () => string;
};

export class AgentSessionStore {
  private readonly homeDir: string;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly listeners = new Map<string, Set<(event: AgentEvent) => void>>();

  constructor(options: AgentSessionStoreOptions = {}) {
    this.homeDir = options.homeDir ?? os.homedir();
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
  }

  async create(input: CreateAgentSessionInput): Promise<AgentSessionRecord> {
    validateStorageId(input.repoId, "repo id");
    const sessionId = input.sessionId ?? this.createId();
    validateStorageId(sessionId, "session id");
    const timestamp = this.now();
    const record: AgentSessionRecord = {
      version: 1,
      sessionId,
      providerId: input.providerId,
      providerSessionId: input.providerSessionId ?? null,
      repoId: input.repoId,
      laneId: input.laneId,
      workspace: path.resolve(input.workspace),
      planId: input.planId,
      title: input.title,
      model: input.model,
      permissionMode: input.permissionMode,
      status: input.status ?? "idle",
      lifecycle: "active",
      parentSessionId: input.parentSessionId ?? null,
      pinnedAt: null,
      archivedAt: null,
      deletedAt: null,
      lastMessagePreview: null,
      workspaceBindings: [{
        bindingId: this.createId(),
        laneId: input.laneId,
        workspace: path.resolve(input.workspace),
        branchName: input.branchName ?? null,
        startingCommit: input.startingCommit ?? null,
        endingCommit: null,
        attachedAt: timestamp,
        retiredAt: null,
        retirementReason: null
      }],
      capabilities: [...new Set(input.capabilities)],
      effectiveSkillHashes: [...new Set(input.effectiveSkillHashes)],
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEventSequence: 0
    };

    await mkdir(this.getSessionDir(input.repoId, sessionId), { recursive: true });
    await this.writeRecord(record);
    return record;
  }

  async load(repoId: string, sessionId: string): Promise<AgentSessionRecord | null> {
    validateStorageId(repoId, "repo id");
    validateStorageId(sessionId, "session id");
    try {
      const parsed = JSON.parse(await readFile(this.getSessionFile(repoId, sessionId), "utf8")) as AgentSessionRecord;
      return normalizeSessionRecord(parsed);
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  async list(repoId: string): Promise<AgentSessionRecord[]> {
    validateStorageId(repoId, "repo id");
    const root = this.getSessionsRoot(repoId);
    const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    });
    const records = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => this.load(repoId, entry.name))
    );
    return records
      .filter((record): record is AgentSessionRecord => record !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async append<K extends AgentEventKind>(repoId: string, sessionId: string, draft: AgentEventDraft<K>): Promise<AgentEvent<K>> {
    return this.enqueue(sessionId, async () => {
      const record = await this.requireSession(repoId, sessionId);
      const event = {
        version: 1,
        eventId: this.createId(),
        sequence: record.lastEventSequence + 1,
        timestamp: this.now(),
        sessionId,
        kind: draft.kind,
        payload: draft.payload,
        ...(draft.providerPayload === undefined ? {} : { providerPayload: draft.providerPayload })
      } as AgentEvent<K>;
      await appendFile(this.getEventsFile(repoId, sessionId), `${JSON.stringify(event)}\n`, "utf8");
      record.lastEventSequence = event.sequence;
      record.updatedAt = event.timestamp;
      applyEventToSession(record, event as AgentEvent);
      await this.writeRecord(record);
      for (const listener of this.listeners.get(sessionId) ?? []) {
        listener(event as AgentEvent);
      }
      return event;
    });
  }

  async readEvents(repoId: string, sessionId: string): Promise<AgentEvent[]> {
    validateStorageId(repoId, "repo id");
    validateStorageId(sessionId, "session id");
    let raw: string;
    try {
      raw = await readFile(this.getEventsFile(repoId, sessionId), "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }
    const events = raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => normalizeAgentEvent(JSON.parse(line) as AgentEvent, index + 1));
    assertContiguousEvents(events, sessionId);
    return events;
  }

  async recover(repoId: string, sessionId: string): Promise<AgentSessionRecord> {
    return this.enqueue(sessionId, async () => {
      const record = await this.requireSession(repoId, sessionId);
      const events = await this.readEvents(repoId, sessionId);
      const lastSequence = events.at(-1)?.sequence ?? 0;
      if (record.lastEventSequence !== lastSequence) {
        record.lastEventSequence = lastSequence;
        record.updatedAt = events.at(-1)?.timestamp ?? record.updatedAt;
        for (const event of events) {
          applyEventToSession(record, event);
        }
        await this.writeRecord(record);
      }
      return record;
    });
  }

  async update(
    repoId: string,
    sessionId: string,
    updates: Partial<Pick<AgentSessionRecord,
      | "title"
      | "providerSessionId"
      | "model"
      | "permissionMode"
      | "status"
      | "effectiveSkillHashes"
      | "lifecycle"
      | "pinnedAt"
      | "archivedAt"
      | "deletedAt"
      | "lastMessagePreview"
      | "workspaceBindings"
    >>
  ): Promise<AgentSessionRecord> {
    return this.enqueue(sessionId, async () => {
      const record = await this.requireSession(repoId, sessionId);
      Object.assign(record, updates, { updatedAt: this.now() });
      if (updates.effectiveSkillHashes) {
        record.effectiveSkillHashes = [...new Set(updates.effectiveSkillHashes)];
      }
      await this.writeRecord(record);
      return record;
    });
  }

  async setPinned(repoId: string, sessionId: string, pinned: boolean): Promise<AgentSessionRecord> {
    return this.update(repoId, sessionId, { pinnedAt: pinned ? this.now() : null });
  }

  async setArchived(repoId: string, sessionId: string, archived: boolean): Promise<AgentSessionRecord> {
    return this.update(repoId, sessionId, {
      lifecycle: archived ? "archived" : "active",
      archivedAt: archived ? this.now() : null,
      deletedAt: null
    });
  }

  async setDeleted(repoId: string, sessionId: string, deleted: boolean): Promise<AgentSessionRecord> {
    return this.update(repoId, sessionId, {
      lifecycle: deleted ? "deleted" : "archived",
      deletedAt: deleted ? this.now() : null,
      archivedAt: deleted ? this.now() : null
    });
  }

  async bindWorkspace(
    repoId: string,
    sessionId: string,
    binding: Pick<AgentSessionWorkspaceBinding, "laneId" | "workspace" | "branchName" | "startingCommit">
  ): Promise<AgentSessionRecord> {
    return this.enqueue(sessionId, async () => {
      const record = await this.requireSession(repoId, sessionId);
      const timestamp = this.now();
      const nextBindings = record.workspaceBindings.map((item) => item.retiredAt
        ? item
        : { ...item, retiredAt: timestamp, retirementReason: "rebound" });
      nextBindings.push({
        bindingId: this.createId(),
        laneId: binding.laneId,
        workspace: path.resolve(binding.workspace),
        branchName: binding.branchName,
        startingCommit: binding.startingCommit,
        endingCommit: null,
        attachedAt: timestamp,
        retiredAt: null,
        retirementReason: null
      });
      Object.assign(record, {
        laneId: binding.laneId,
        workspace: path.resolve(binding.workspace),
        workspaceBindings: nextBindings,
        lifecycle: "active",
        archivedAt: null,
        deletedAt: null,
        updatedAt: timestamp
      });
      await this.writeRecord(record);
      return record;
    });
  }

  async retireWorkspace(
    repoId: string,
    sessionId: string,
    options: { endingCommit?: string | null; reason: string }
  ): Promise<AgentSessionRecord> {
    return this.enqueue(sessionId, async () => {
      const record = await this.requireSession(repoId, sessionId);
      const timestamp = this.now();
      record.workspaceBindings = record.workspaceBindings.map((binding) => binding.retiredAt
        ? binding
        : {
            ...binding,
            endingCommit: options.endingCommit ?? binding.endingCommit,
            retiredAt: timestamp,
            retirementReason: options.reason
          });
      record.updatedAt = timestamp;
      await this.writeRecord(record);
      return record;
    });
  }

  subscribe(sessionId: string, listener: (event: AgentEvent) => void): () => void {
    validateStorageId(sessionId, "session id");
    const listeners = this.listeners.get(sessionId) ?? new Set<(event: AgentEvent) => void>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  getRepoRoot(repoId: string): string {
    validateStorageId(repoId, "repo id");
    return path.join(this.homeDir, ".srgical", "repos", repoId);
  }

  private getSessionsRoot(repoId: string): string {
    return path.join(this.getRepoRoot(repoId), "sessions");
  }

  private getSessionDir(repoId: string, sessionId: string): string {
    validateStorageId(sessionId, "session id");
    return path.join(this.getSessionsRoot(repoId), sessionId);
  }

  private getSessionFile(repoId: string, sessionId: string): string {
    return path.join(this.getSessionDir(repoId, sessionId), "session.json");
  }

  private getEventsFile(repoId: string, sessionId: string): string {
    return path.join(this.getSessionDir(repoId, sessionId), "events.jsonl");
  }

  private async requireSession(repoId: string, sessionId: string): Promise<AgentSessionRecord> {
    const record = await this.load(repoId, sessionId);
    if (!record) {
      throw new Error(`Unknown agent session \`${sessionId}\` for repository \`${repoId}\`.`);
    }
    return record;
  }

  private async writeRecord(record: AgentSessionRecord): Promise<void> {
    const filePath = this.getSessionFile(record.repoId, record.sessionId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
  }

  private async enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.queues.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(sessionId) === current) {
        this.queues.delete(sessionId);
      }
    }
  }
}

export function deriveRepositoryId(repositoryRoot: string): string {
  const resolved = path.resolve(repositoryRoot).replace(/\\/g, "/").toLowerCase();
  const label = path.basename(repositoryRoot).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
  const digest = createHash("sha256").update(resolved).digest("hex").slice(0, 12);
  return `${label.slice(0, 48)}-${digest}`;
}

function validateStorageId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`Invalid ${label}: \`${value}\`.`);
  }
}

function normalizeSessionRecord(value: AgentSessionRecord): AgentSessionRecord {
  if (!value || value.version !== 1 || typeof value.sessionId !== "string" || typeof value.repoId !== "string") {
    throw new Error("Invalid agent session record.");
  }
  validateStorageId(value.repoId, "repo id");
  validateStorageId(value.sessionId, "session id");
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString();
  const workspace = path.resolve(value.workspace);
  return {
    ...value,
    lifecycle: value.lifecycle === "archived" || value.lifecycle === "deleted" ? value.lifecycle : "active",
    parentSessionId: typeof value.parentSessionId === "string" ? value.parentSessionId : null,
    pinnedAt: typeof value.pinnedAt === "string" ? value.pinnedAt : null,
    archivedAt: typeof value.archivedAt === "string" ? value.archivedAt : null,
    deletedAt: typeof value.deletedAt === "string" ? value.deletedAt : null,
    lastMessagePreview: typeof value.lastMessagePreview === "string" ? value.lastMessagePreview : null,
    workspaceBindings: Array.isArray(value.workspaceBindings) && value.workspaceBindings.length > 0
      ? value.workspaceBindings.map((binding, index) => normalizeWorkspaceBinding(binding, value, index))
      : [{
          bindingId: `legacy-${value.sessionId}`,
          laneId: value.laneId,
          workspace,
          branchName: null,
          startingCommit: null,
          endingCommit: null,
          attachedAt: createdAt,
          retiredAt: null,
          retirementReason: null
        }]
  };
}

function normalizeWorkspaceBinding(
  binding: AgentSessionWorkspaceBinding,
  session: AgentSessionRecord,
  index: number
): AgentSessionWorkspaceBinding {
  return {
    bindingId: typeof binding.bindingId === "string" ? binding.bindingId : `binding-${session.sessionId}-${index + 1}`,
    laneId: typeof binding.laneId === "string" ? binding.laneId : session.laneId,
    workspace: path.resolve(typeof binding.workspace === "string" ? binding.workspace : session.workspace),
    branchName: typeof binding.branchName === "string" ? binding.branchName : null,
    startingCommit: typeof binding.startingCommit === "string" ? binding.startingCommit : null,
    endingCommit: typeof binding.endingCommit === "string" ? binding.endingCommit : null,
    attachedAt: typeof binding.attachedAt === "string" ? binding.attachedAt : session.createdAt,
    retiredAt: typeof binding.retiredAt === "string" ? binding.retiredAt : null,
    retirementReason: typeof binding.retirementReason === "string" ? binding.retirementReason : null
  };
}

function normalizeAgentEvent(value: AgentEvent, lineNumber: number): AgentEvent {
  if (!value || value.version !== 1 || typeof value.eventId !== "string" || typeof value.sessionId !== "string") {
    throw new Error(`Invalid agent event on line ${lineNumber}.`);
  }
  if (!Number.isInteger(value.sequence) || value.sequence < 1 || typeof value.kind !== "string") {
    throw new Error(`Invalid agent event sequence on line ${lineNumber}.`);
  }
  return value;
}

function assertContiguousEvents(events: AgentEvent[], sessionId: string): void {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.sessionId !== sessionId || event.sequence !== index + 1) {
      throw new Error(`Agent event stream for \`${sessionId}\` is not contiguous at sequence ${index + 1}.`);
    }
  }
}

function applyEventToSession(record: AgentSessionRecord, event: AgentEvent): void {
  if (event.kind === "message.completed") {
    record.lastMessagePreview = event.payload.text.replace(/\s+/g, " ").trim().slice(0, 180) || record.lastMessagePreview;
  }
  switch (event.kind) {
    case "session.started":
      record.status = "running";
      record.providerSessionId = event.payload.providerSessionId ?? record.providerSessionId;
      record.model = event.payload.model ?? record.model;
      break;
    case "session.status":
      record.status = event.payload.status;
      break;
    case "session.completed":
      record.status = "completed";
      break;
    case "session.failed":
      record.status = "failed";
      break;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
