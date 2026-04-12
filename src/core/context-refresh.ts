import { refreshContextDocument } from "./agent";
import { readPackSnapshot } from "./change-summary";
import { applyPlanningDocumentState } from "./planning-doc-state";
import { readPlanningPackState, type PlanningMode } from "./planning-pack-state";
import { recordVisibleChange } from "./prepare-pack";
import { refreshPlanningAdvice } from "./planning-advice";
import type { ChatMessage, ContextRefreshSource } from "./prompts";
import { getPlanningPackPaths, type PlanningPathOptions } from "./workspace";

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
  } = {}
): Promise<ContextRefreshResult> {
  const before = await readPackSnapshot(workspaceRoot, options);
  const summary = await refreshContextDocument(workspaceRoot, messages, sources, options);
  const paths = getPlanningPackPaths(workspaceRoot, options);

  await applyPlanningDocumentState(paths, "context", "grounded");

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
