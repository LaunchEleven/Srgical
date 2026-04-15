import { refreshContextDocument } from "./agent";
import { readPackSnapshot } from "./change-summary";
import { applyPlanningDocumentState } from "./planning-doc-state";
import { readPlanningPackState, type PlanningMode } from "./planning-pack-state";
import { recordVisibleChange } from "./prepare-pack";
import { refreshPlanningAdvice } from "./planning-advice";
import type { ChatMessage, ContextRefreshSource } from "./prompts";
import { getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

export type ContextRefreshResult = {
  summary: string;
  headline: string;
  nextAction: string;
  unknowns: string[];
  evidence: string[];
};

export async function syncPlanningContext(
  workspaceRoot: string,
  messages: ChatMessage[],
  sources: ContextRefreshSource[],
  options: PlanningPathOptions & {
    onOutputChunk?: (chunk: string) => void;
    preserveSourcesVerbatim?: boolean;
  } = {}
): Promise<ContextRefreshResult> {
  const before = await readPackSnapshot(workspaceRoot, options);
  const summary = await refreshContextDocument(workspaceRoot, messages, sources, options);
  const paths = getPlanningPackPaths(workspaceRoot, options);

  await applyPlanningDocumentState(paths, "context", "grounded");
  if (options.preserveSourcesVerbatim) {
    const currentContext = await readText(paths.context);
    const updatedContext = captureSourcesInContext(currentContext, sources);

    if (updatedContext !== currentContext) {
      await writeText(paths.context, updatedContext);
    }
  }

  const advice = await refreshPlanningAdvice(workspaceRoot, messages, options).catch(() => null);
  const state = await readPlanningPackState(workspaceRoot, options);
  const evidence = mergeUnique(state.evidence, sources.map((source) => source.path));
  const unknowns = advice?.researchNeeded ?? state.unknowns;
  const nextAction = advice?.nextAction ?? defaultContextNextAction(state.packMode === "authored");
  const headline = await recordVisibleChange(workspaceRoot, before, "Refreshed the living context doc.", {
    ...options,
    action: "refine",
    stage: normalizeStageForContextRefresh(state.mode),
    nextAction,
    evidence,
    unknowns
  });

  return {
    summary,
    headline,
    nextAction,
    unknowns,
    evidence
  };
}

function defaultContextNextAction(hasDraft: boolean): string {
  return hasDraft
    ? "Review the refreshed context, then rebuild the draft so the plan reflects the new evidence."
    : "Review the refreshed context, then build the first draft when the direction is clear enough.";
}

function normalizeStageForContextRefresh(mode: PlanningMode): PlanningMode {
  if (mode === "No Pack") {
    return "Discover";
  }

  if (mode === "Ready" || mode === "Execute" || mode === "Blocked" || mode === "Finished" || mode === "Out of Date" || mode === "Auto Running") {
    return "Prepare";
  }

  return mode;
}

function mergeUnique(existing: string[], additions: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const item of [...existing, ...additions]) {
    const normalized = item.replace(/\s+/g, " ").trim();

    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(normalized);
  }

  return merged;
}

const SOURCE_CAPTURE_SECTION_START = "<!-- SRGICAL:SOURCE_CAPTURE_SECTION -->";
const SOURCE_CAPTURE_SECTION_END = "<!-- /SRGICAL:SOURCE_CAPTURE_SECTION -->";
const SOURCE_CAPTURE_HEADING = "## Imported Source Snapshots";
const SOURCE_CAPTURE_BLOCK_OPEN = "<!-- SRGICAL:SOURCE_CAPTURE ";
const SOURCE_CAPTURE_BLOCK_CLOSE = "<!-- /SRGICAL:SOURCE_CAPTURE -->";

export function captureSourcesInContext(
  context: string,
  sources: ContextRefreshSource[],
  capturedAt: string = new Date().toISOString()
): string {
  const normalizedSources = normalizeContextSources(sources);

  if (normalizedSources.length === 0) {
    return context;
  }

  const sectionRegex = new RegExp(
    `${escapeRegExp(SOURCE_CAPTURE_SECTION_START)}\\n([\\s\\S]*?)\\n${escapeRegExp(SOURCE_CAPTURE_SECTION_END)}`,
    "m"
  );
  const sectionMatch = sectionRegex.exec(context);
  const existingBlocks = parseSourceCaptureBlocks(sectionMatch?.[1] ?? "");

  for (const source of normalizedSources) {
    existingBlocks.set(source.path, renderSourceCaptureBlock(source.path, source.content, capturedAt));
  }

  const renderedSection = [
    SOURCE_CAPTURE_SECTION_START,
    [
      SOURCE_CAPTURE_HEADING,
      "",
      ...Array.from(existingBlocks.values())
    ].join("\n\n"),
    SOURCE_CAPTURE_SECTION_END
  ].join("\n");

  if (sectionMatch) {
    return context.replace(sectionRegex, renderedSection);
  }

  return `${context.trimEnd()}\n\n${renderedSection}\n`;
}

function parseSourceCaptureBlocks(sectionBody: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const blockRegex = new RegExp(
    `${escapeRegExp(SOURCE_CAPTURE_BLOCK_OPEN)}(.+?) -->\\n([\\s\\S]*?)\\n${escapeRegExp(SOURCE_CAPTURE_BLOCK_CLOSE)}`,
    "g"
  );

  for (const match of sectionBody.matchAll(blockRegex)) {
    const metadataRaw = match[1];
    const blockBody = match[2];

    if (!metadataRaw || !blockBody) {
      continue;
    }

    const sourcePath = parseSourcePath(metadataRaw);

    if (!sourcePath) {
      continue;
    }

    blocks.set(
      sourcePath,
      `${SOURCE_CAPTURE_BLOCK_OPEN}${metadataRaw} -->\n${blockBody}\n${SOURCE_CAPTURE_BLOCK_CLOSE}`
    );
  }

  return blocks;
}

function renderSourceCaptureBlock(path: string, content: string, capturedAt: string): string {
  const metadata = JSON.stringify({ path, capturedAt });
  const fence = selectCodeFence(content);
  const body = content.trimEnd() || "(empty source)";

  return [
    `${SOURCE_CAPTURE_BLOCK_OPEN}${metadata} -->`,
    `### Source: \`${path}\``,
    `Captured: ${capturedAt}`,
    "",
    `${fence}markdown`,
    body,
    fence,
    SOURCE_CAPTURE_BLOCK_CLOSE
  ].join("\n");
}

function normalizeContextSources(sources: ContextRefreshSource[]): Array<{ path: string; content: string }> {
  const seen = new Set<string>();
  const normalized: Array<{ path: string; content: string }> = [];

  for (const source of sources) {
    const sourcePath = source.path.replace(/\s+/g, " ").trim();

    if (!sourcePath) {
      continue;
    }

    const key = sourcePath.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({
      path: sourcePath,
      content: source.content
    });
  }

  return normalized;
}

function parseSourcePath(metadataRaw: string): string | null {
  try {
    const parsed = JSON.parse(metadataRaw) as { path?: unknown };

    if (typeof parsed.path === "string") {
      const normalizedPath = parsed.path.replace(/\s+/g, " ").trim();
      return normalizedPath || null;
    }
  } catch {
    return null;
  }

  return null;
}

function selectCodeFence(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longestRun + 1));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
