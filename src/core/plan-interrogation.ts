import { fileExists, getPlanningPackPaths, readText, type PlanningPathOptions } from "./workspace";
import { PLANNING_FRAMEWORK_WRAPPER } from "./prompts";

const DOC_SNIPPET_LIMIT = 3500;

export type PlanInterrogationCommand = "assess" | "gather" | "gaps" | "ready";

export async function buildPlanInterrogationDirective(
  workspaceRoot: string,
  command: PlanInterrogationCommand,
  focusText: string,
  options: PlanningPathOptions = {}
): Promise<string> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const [plan, context, tracker, handoff, nextPrompt] = await Promise.all([
    readDocSnippet(paths.plan),
    readDocSnippet(paths.context),
    readDocSnippet(paths.tracker),
    readDocSnippet(paths.changes),
    readDocSnippet(paths.manifest)
  ]);

  return [
    "Plan interrogation mode is active for the current planner reply.",
    `Command: /${command}${focusText ? ` ${focusText}` : ""}`,
    `Workspace: ${workspaceRoot}`,
    `Plan directory: ${paths.relativeDir}`,
    "",
    "You must reason against the current planning docs and transcript only.",
    "Do not invent repo facts. If a fact is unknown, say it is unknown.",
    "Be practical and execution-oriented, not academic.",
    "",
    PLANNING_FRAMEWORK_WRAPPER,
    "",
    renderCommandInstruction(command, focusText),
    "",
    "Output contract:",
    "- Keep sections crisp and directly actionable.",
    "- Use bullets with concrete edits or follow-up actions.",
    "- If clarity is insufficient, call it out and propose the minimum plan changes to fix it.",
    "",
    "Current planning docs snapshot:",
    "",
    renderNamedSnippet("plan.md", plan),
    "",
    renderNamedSnippet("context.md", context),
    "",
    renderNamedSnippet("tracker.md", tracker),
    "",
    renderNamedSnippet("changes.md", handoff),
    "",
    renderNamedSnippet("manifest.json", nextPrompt)
  ].join("\n");
}

export async function buildBlockedStepResolutionDirective(
  workspaceRoot: string,
  blockedStepId: string,
  blockedNotes: string,
  focusText: string,
  options: PlanningPathOptions = {}
): Promise<string> {
  const base = await buildPlanInterrogationDirective(workspaceRoot, "gather", focusText, options);
  const notes = blockedNotes.trim().length > 0 ? blockedNotes.trim() : "none recorded";

  return [
    base,
    "",
    "Blocked-step resolution overlay:",
    `- blocked-step-id: ${blockedStepId}`,
    `- blocked-step-notes: ${notes}`,
    "- You are in studio operate and need to unblock this step without leaving execution flow.",
    "",
    "Return sections:",
    "- Root cause hypothesis (from tracker + handoff evidence)",
    "- Fastest unblock path (preferred)",
    "- Fallback unblock paths",
    "- Exact tracker edits to apply (status, notes, Next step)",
    "- Immediate next command to run in operate mode"
  ].join("\n");
}

function renderCommandInstruction(command: PlanInterrogationCommand, focusText: string): string {
  const focus = focusText.trim();
  const focusLine = focus ? `Focus: ${focus}` : "Focus: entire active plan.";

  switch (command) {
    case "assess":
      return [
        "Assessment objective:",
        "Assess whether the current plan is understandable and executable to completion with maximal practical accuracy.",
        "Answer explicitly:",
        "- objective-understood: yes/no",
        "- execution-clarity: high/medium/low",
        "- can-execute-with-100%-accuracy-now: yes/no",
        "- if no: exact plan improvements needed before execution",
        focusLine
      ].join("\n");
    case "gather":
      return [
        "Gather objective:",
        "Gather missing context and refine the plan state with concrete next discovery actions.",
        "Return:",
        "- what is already clear",
        "- what context is still missing",
        "- targeted repo/doc areas to inspect next",
        "- concrete follow-up prompts/questions to close gaps",
        focusLine
      ].join("\n");
    case "gaps":
      return [
        "Gap objective:",
        "List the smallest set of missing details that block confident end-to-end execution.",
        "Return:",
        "- critical gaps",
        "- why each gap blocks execution",
        "- one direct fix per gap",
        focusLine
      ].join("\n");
    case "ready":
      return [
        "Readiness objective:",
        "Decide if the plan is execution-ready right now.",
        "Return:",
        "- verdict: GO or NO-GO",
        "- readiness score: x/10",
        "- blockers (if any)",
        "- exact next edits to reach GO",
        focusLine
      ].join("\n");
  }
}

async function readDocSnippet(filePath: string): Promise<string> {
  if (!(await fileExists(filePath))) {
    return "- missing";
  }

  try {
    const raw = await readText(filePath);
    const normalized = raw.replace(/\r\n/g, "\n").trim();

    if (!normalized) {
      return "- present but empty";
    }

    if (normalized.length <= DOC_SNIPPET_LIMIT) {
      return normalized;
    }

    return `${normalized.slice(0, DOC_SNIPPET_LIMIT).trimEnd()}\n... [truncated after ${DOC_SNIPPET_LIMIT} chars]`;
  } catch {
    return "- unreadable";
  }
}

function renderNamedSnippet(name: string, content: string): string {
  return `${name}:\n${content}`;
}
