import type { ChatMessage, ContextRefreshSource } from "./prompts";
import { ensurePlanningPackState } from "./planning-state";
import { getInitialTemplates } from "./templates";
import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

export async function writePlanningPackFallback(
  workspaceRoot: string,
  messages: ChatMessage[],
  reason: string,
  agentLabel = "Codex",
  options: PlanningPathOptions = {}
): Promise<string> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const templates = getInitialTemplates(paths);
  const createdFiles: string[] = [];
  const preservedFiles: string[] = [];

  for (const [filePath, content] of Object.entries(templates)) {
    const exists = await fileExists(filePath);

    if (exists) {
      preservedFiles.push(toPackLabel(paths, filePath));
      continue;
    }

    await writeText(filePath, content);
    createdFiles.push(toPackLabel(paths, filePath));
  }

  const currentPosition = await readCurrentPosition(paths.tracker);
  const context = await readText(paths.context);
  const updatedContext = appendFallbackEntry(
    context,
    buildFallbackEntry(messages, reason, createdFiles, preservedFiles, currentPosition, agentLabel)
  );
  await writeText(paths.context, updatedContext);

  const summary = [
    `Local fallback prepare refresh completed because ${agentLabel} was unavailable.`,
    `Reason: ${reason}`,
    createdFiles.length > 0 ? `Created: ${createdFiles.join(", ")}` : "Created: none",
    preservedFiles.length > 0 ? `Preserved: ${preservedFiles.join(", ")}` : "Preserved: none",
    currentPosition.nextStepId
      ? `Tracker remains on next step: ${currentPosition.nextStepId}`
      : "Tracker next step is not yet available."
  ];

  await ensurePlanningPackState(workspaceRoot, "scaffolded", options);

  return summary.join("\n");
}

export async function refreshContextDocumentFallback(
  workspaceRoot: string,
  messages: ChatMessage[],
  sources: ContextRefreshSource[],
  reason: string,
  agentLabel = "Codex",
  options: PlanningPathOptions = {}
): Promise<string> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const templates = getInitialTemplates(paths);
  const createdFiles: string[] = [];

  for (const [filePath, content] of Object.entries(templates)) {
    if (await fileExists(filePath)) {
      continue;
    }

    await writeText(filePath, content);
    createdFiles.push(toPackLabel(paths, filePath));
  }

  const existingContext = await readText(paths.context);
  const updatedContext = appendFallbackEntry(
    existingContext,
    buildContextRefreshFallbackEntry(messages, sources, reason, createdFiles, agentLabel)
  );
  await writeText(paths.context, updatedContext);
  await ensurePlanningPackState(workspaceRoot, "scaffolded", options);

  const sourceList = sources.map((source) => source.path).filter(Boolean);
  return [
    `Local fallback context refresh completed because ${agentLabel} was unavailable.`,
    `Reason: ${reason}`,
    createdFiles.length > 0 ? `Created: ${createdFiles.join(", ")}` : "Created: none",
    sourceList.length > 0 ? `Sources: ${sourceList.join(", ")}` : "Sources: transcript only",
    `Updated: ${paths.relativeDir}/context.md`
  ].join("\n");
}

function buildFallbackEntry(
  messages: ChatMessage[],
  reason: string,
  createdFiles: string[],
  preservedFiles: string[],
  currentPosition: {
    lastCompleted: string | null;
    nextStepId: string | null;
  },
  agentLabel: string
): string {
  const now = new Date();
  const transcriptSummary = summarizeRecentUserMessages(messages);
  const nextStepId = currentPosition.nextStepId ?? "DISCOVER-001";

  return [
    `### ${now.toISOString().slice(0, 10)} - PACK-LOCAL - srgical`,
    "",
    `- Triggered an explicit local prepare refresh because ${agentLabel} was unavailable.`,
    `- Reason: ${reason}.`,
    createdFiles.length > 0
      ? `- Created missing planning-pack files: ${createdFiles.join(", ")}.`
      : "- Created missing planning-pack files: none.",
    preservedFiles.length > 0
      ? `- Preserved existing planning-pack files: ${preservedFiles.join(", ")}.`
      : "- Preserved existing planning-pack files: none.",
    transcriptSummary
      ? `- Recent user direction: ${transcriptSummary}.`
      : "- Recent user direction: no user transcript was available for summarization.",
    `- Validation: local fallback pack refresh completed without invoking ${agentLabel}.`,
    `- Blockers: live planner and live pack-authoring behavior remain unavailable until ${agentLabel} is restored.`,
    `- Next step: \`${nextStepId}\`.`
  ].join("\n");
}

function buildContextRefreshFallbackEntry(
  messages: ChatMessage[],
  sources: ContextRefreshSource[],
  reason: string,
  createdFiles: string[],
  agentLabel: string
): string {
  const now = new Date();
  const transcriptSummary = summarizeRecentUserMessages(messages);
  const sourceSummary = summarizeContextSources(sources);

  return [
    `### ${now.toISOString().slice(0, 10)} - CONTEXT-LOCAL - srgical`,
    "",
    `- Triggered an explicit local context refresh because ${agentLabel} was unavailable.`,
    `- Reason: ${reason}.`,
    createdFiles.length > 0
      ? `- Created missing planning-pack files: ${createdFiles.join(", ")}.`
      : "- Created missing planning-pack files: none.",
    sourceSummary
      ? `- Imported evidence: ${sourceSummary}.`
      : "- Imported evidence: transcript-driven context refresh with no direct source files.",
    transcriptSummary
      ? `- Recent user direction: ${transcriptSummary}.`
      : "- Recent user direction: no user transcript was available for summarization.",
    `- Validation: local fallback context refresh completed without invoking ${agentLabel}.`,
    `- Blockers: intelligent context reshaping remains unavailable until ${agentLabel} is restored.`
  ].join("\n");
}

async function readCurrentPosition(trackerPath: string): Promise<{
  lastCompleted: string | null;
  nextStepId: string | null;
}> {
  const exists = await fileExists(trackerPath);

  if (!exists) {
    return {
      lastCompleted: null,
      nextStepId: null
    };
  }

  try {
    const tracker = await readText(trackerPath);
    return {
      lastCompleted: readCurrentPositionValue(tracker, "Last completed"),
      nextStepId: readCurrentPositionValue(tracker, "Next step")
    };
  } catch {
    return {
      lastCompleted: null,
      nextStepId: null
    };
  }
}

function readCurrentPositionValue(tracker: string, label: string): string | null {
  const match = tracker.match(new RegExp(`- ${escapeRegExp(label)}: \`([^\`]+)\``));
  return match?.[1] ?? null;
}

function summarizeRecentUserMessages(messages: ChatMessage[]): string {
  const recent = messages
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => sanitizeInlineText(message.content))
    .filter(Boolean);

  if (recent.length === 0) {
    return "";
  }

  return recent.join(" | ");
}

function sanitizeInlineText(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();

  if (collapsed.length <= 180) {
    return collapsed;
  }

  return `${collapsed.slice(0, 177).trimEnd()}...`;
}

function summarizeContextSources(sources: ContextRefreshSource[]): string {
  const summarized = sources
    .map((source) => {
      const pathLabel = sanitizeInlineText(source.path);
      const body = sanitizeInlineText(source.content);
      return body ? `${pathLabel} -> ${body}` : pathLabel;
    })
    .filter(Boolean);

  if (summarized.length === 0) {
    return "";
  }

  return summarized.slice(0, 3).join(" | ");
}

function appendFallbackEntry(context: string, entry: string): string {
  if (context.includes("## Evidence Gathered")) {
    return `${context.trimEnd()}\n\n${entry}\n`;
  }

  return `${context.trimEnd()}\n\n## Evidence Gathered\n\n${entry}\n`;
}

function toPackLabel(paths: ReturnType<typeof getPlanningPackPaths>, filePath: string): string {
  const prefix = `${paths.relativeDir}/`;

  if (filePath === paths.plan) {
    return `${prefix}plan.md`;
  }

  if (filePath === paths.context) {
    return `${prefix}context.md`;
  }

  if (filePath === paths.tracker) {
    return `${prefix}tracker.md`;
  }

  if (filePath === paths.changes) {
    return `${prefix}changes.md`;
  }

  if (filePath === paths.manifest) {
    return `${prefix}manifest.json`;
  }

  return filePath;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
