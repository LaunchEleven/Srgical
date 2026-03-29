import type { ChatMessage } from "./prompts";
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
    `Local fallback pack refresh completed because ${agentLabel} was unavailable.`,
    `Reason: ${reason}`,
    createdFiles.length > 0 ? `Created: ${createdFiles.join(", ")}` : "Created: none",
    preservedFiles.length > 0 ? `Preserved: ${preservedFiles.join(", ")}` : "Preserved: none",
    currentPosition.nextRecommended
      ? `Tracker remains on next recommended step: ${currentPosition.nextRecommended}`
      : "Tracker next step is not yet available."
  ];

  await ensurePlanningPackState(workspaceRoot, "scaffolded", options);

  return summary.join("\n");
}

function buildFallbackEntry(
  messages: ChatMessage[],
  reason: string,
  createdFiles: string[],
  preservedFiles: string[],
  currentPosition: {
    lastCompleted: string | null;
    nextRecommended: string | null;
  },
  agentLabel: string
): string {
  const now = new Date();
  const transcriptSummary = summarizeRecentUserMessages(messages);
  const nextRecommended = currentPosition.nextRecommended ?? "PLAN-001";

  return [
    `### ${now.toISOString().slice(0, 10)} - PACK-LOCAL - srgical`,
    "",
    `- Triggered an explicit local planning-pack refresh because ${agentLabel} was unavailable.`,
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
    `- Next recommended work: \`${nextRecommended}\`.`
  ].join("\n");
}

async function readCurrentPosition(trackerPath: string): Promise<{
  lastCompleted: string | null;
  nextRecommended: string | null;
}> {
  const exists = await fileExists(trackerPath);

  if (!exists) {
    return {
      lastCompleted: null,
      nextRecommended: null
    };
  }

  try {
    const tracker = await readText(trackerPath);
    return {
      lastCompleted: readCurrentPositionValue(tracker, "Last Completed"),
      nextRecommended: readCurrentPositionValue(tracker, "Next Recommended")
    };
  } catch {
    return {
      lastCompleted: null,
      nextRecommended: null
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

function appendFallbackEntry(context: string, entry: string): string {
  if (context.includes("## Handoff Log")) {
    return `${context.trimEnd()}\n\n${entry}\n`;
  }

  return `${context.trimEnd()}\n\n## Handoff Log\n\n${entry}\n`;
}

function toPackLabel(paths: ReturnType<typeof getPlanningPackPaths>, filePath: string): string {
  const prefix = `${paths.relativeDir}/`;

  if (filePath === paths.plan) {
    return `${prefix}01-product-plan.md`;
  }

  if (filePath === paths.context) {
    return `${prefix}02-agent-context-kickoff.md`;
  }

  if (filePath === paths.tracker) {
    return `${prefix}03-detailed-implementation-plan.md`;
  }

  if (filePath === paths.nextPrompt) {
    return `${prefix}04-next-agent-prompt.md`;
  }

  if (filePath === paths.handoff) {
    return `${prefix}HandoffDoc.md`;
  }

  return filePath;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
