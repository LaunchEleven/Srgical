import type { ChatMessage } from "./prompts";
import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

type StoredStudioSession = {
  version: 2;
  updatedAt: string;
  messages: ChatMessage[];
  activeAgentId?: string | null;
};

export const DEFAULT_STUDIO_MESSAGES: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Describe what you are building, what is already true in the repo, or the next decision you need to make. I will help turn it into a disciplined `.srgical/` execution pack, and `/write` will update the repo files when you are ready."
  }
];

export type StudioSessionState = {
  messages: ChatMessage[];
  activeAgentId: string | null;
};

export async function loadStudioSession(workspaceRoot: string, options: PlanningPathOptions = {}): Promise<ChatMessage[]> {
  return (await loadStudioSessionState(workspaceRoot, options)).messages;
}

export async function loadStudioSessionState(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<StudioSessionState> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const exists = await fileExists(paths.studioSession);

  if (!exists) {
    return createDefaultSessionState();
  }

  try {
    const raw = await readText(paths.studioSession);
    const parsed = JSON.parse(raw) as Partial<StoredStudioSession>;
    const messages = Array.isArray(parsed.messages) ? sanitizeMessages(parsed.messages) : [];

    return {
      messages: messages.length > 0 ? messages : cloneMessages(DEFAULT_STUDIO_MESSAGES),
      activeAgentId: sanitizeActiveAgentId(parsed.activeAgentId)
    };
  } catch {
    return createDefaultSessionState();
  }
}

export async function saveStudioSession(
  workspaceRoot: string,
  messages: ChatMessage[],
  options: PlanningPathOptions = {}
): Promise<void> {
  const currentState = await loadStudioSessionState(workspaceRoot, options);
  await writeStudioSession(workspaceRoot, {
    messages,
    activeAgentId: currentState.activeAgentId
  }, options);
}

export async function loadStoredActiveAgentId(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<string | null> {
  return (await loadStudioSessionState(workspaceRoot, options)).activeAgentId;
}

export async function saveStoredActiveAgentId(
  workspaceRoot: string,
  activeAgentId: string | null,
  options: PlanningPathOptions = {}
): Promise<void> {
  const currentState = await loadStudioSessionState(workspaceRoot, options);
  await writeStudioSession(workspaceRoot, {
    messages: currentState.messages,
    activeAgentId
  }, options);
}

async function writeStudioSession(
  workspaceRoot: string,
  state: StudioSessionState,
  options: PlanningPathOptions = {}
): Promise<void> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const payload: StoredStudioSession = {
    version: 2,
    updatedAt: new Date().toISOString(),
    messages: sanitizeMessages(state.messages),
    activeAgentId: sanitizeActiveAgentId(state.activeAgentId)
  };

  await writeText(paths.studioSession, JSON.stringify(payload, null, 2));
}

function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message): message is ChatMessage => {
      if (!message || typeof message !== "object") {
        return false;
      }

      return isRole(message.role) && typeof message.content === "string" && message.content.trim().length > 0;
    })
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
}

function createDefaultSessionState(): StudioSessionState {
  return {
    messages: cloneMessages(DEFAULT_STUDIO_MESSAGES),
    activeAgentId: null
  };
}

function sanitizeActiveAgentId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isRole(value: unknown): value is ChatMessage["role"] {
  return value === "user" || value === "assistant" || value === "system";
}
