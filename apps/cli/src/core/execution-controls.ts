import { getPrimaryAgentAdapter } from "./agent";
import type { PlanningStepSummary } from "./planning-pack-state";

const PROMPT_PREVIEW_LINE_LIMIT = 18;
const PROMPT_PREVIEW_CHAR_LIMIT = 1200;

export function renderExecutionStepLines(
  nextStepSummary: PlanningStepSummary | null,
  nextRecommended: string | null
): string[] {
  if (!nextStepSummary) {
    return [
      "Next step summary: unavailable.",
      nextRecommended
        ? `Tracker points to \`${nextRecommended}\`, but its table row could not be summarized.`
        : "Tracker does not currently expose a next recommended step."
    ];
  }

  const lines = [
    `Next step: ${nextStepSummary.id}${nextStepSummary.phase ? ` (${nextStepSummary.phase})` : ""}`,
    `Scope: ${nextStepSummary.scope || "unknown"}`,
    `Acceptance: ${nextStepSummary.acceptance || "unknown"}`
  ];

  if (nextStepSummary.notes) {
    lines.push(`Notes: ${nextStepSummary.notes}`);
  }

  return lines;
}

export function hasQueuedNextStep(nextRecommended: string | null): boolean {
  return Boolean(nextRecommended);
}

export function formatNoQueuedNextStepMessage(source: "studio" | "run-next"): string {
  return [
    "No next step is currently queued in `.srgical/plans/<id>/tracker.md`.",
    source === "run-next"
      ? "Run `srgical prepare <id>` to reshape the plan or queue more work before executing again."
      : "Use prepare to reshape the plan or queue more work before running execution again."
  ].join("\n");
}

export function formatStepLabel(
  nextStepSummary: PlanningStepSummary | null,
  nextRecommended: string | null
): string | null {
  if (nextStepSummary) {
    return `\`${nextStepSummary.id}\`${nextStepSummary.phase ? ` (${nextStepSummary.phase})` : ""}`;
  }

  if (nextRecommended) {
    return `\`${nextRecommended}\``;
  }

  return null;
}

export function renderDryRunPreview(
  prompt: string,
  nextStepSummary: PlanningStepSummary | null,
  nextRecommended: string | null
): string[] {
  const lines = [
    "Execution dry run:",
    ...renderExecutionStepLines(nextStepSummary, nextRecommended),
    "",
    ...buildPromptPreviewLines(prompt),
    "",
    `Dry run only: ${getPrimaryAgentAdapter().label} was not invoked and no execution state or run log was updated.`
  ];

  return lines;
}

export function formatExecutionFailureMessage(
  errorMessage: string,
  nextStepSummary: PlanningStepSummary | null,
  nextRecommended: string | null,
  source: "studio" | "run-next"
): string {
  const lines = [
    `Execution failed${formatStepLabel(nextStepSummary, nextRecommended) ? ` for ${formatStepLabel(nextStepSummary, nextRecommended)}` : ""}.`,
    `Reason: ${errorMessage}`,
    "",
    "Recovery:",
    "- Review `.srgical/plans/<id>/plan.md`, `.srgical/plans/<id>/context.md`, `.srgical/plans/<id>/tracker.md`, and `.srgical/plans/<id>/changes.md`.",
    "- Inspect `.srgical/plans/<id>/execution-state.json` for the latest recorded failure summary."
  ];

  if (source === "run-next") {
    lines.push("- Inspect `.srgical/plans/<id>/execution-log.md` for the durable run history.");
  }

  lines.push("- Preview safely with `srgical operate <id> --dry-run` or `/preview` in operate.");

  return lines.join("\n");
}

function buildPromptPreviewLines(prompt: string): string[] {
  const promptLines = prompt.split(/\r?\n/);
  const preview = promptLines.slice(0, PROMPT_PREVIEW_LINE_LIMIT).join("\n");
  const trimmedPreview = preview.length <= PROMPT_PREVIEW_CHAR_LIMIT ? preview : `${preview.slice(0, PROMPT_PREVIEW_CHAR_LIMIT).trimEnd()}...`;

  return [
    `Prompt preview: first ${Math.min(PROMPT_PREVIEW_LINE_LIMIT, promptLines.length)} of ${promptLines.length} lines.`,
    "",
    trimmedPreview,
    ...(promptLines.length > PROMPT_PREVIEW_LINE_LIMIT ? ["", "... [preview truncated]"] : [])
  ];
}
