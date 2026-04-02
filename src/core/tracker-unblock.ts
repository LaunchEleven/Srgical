import { getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

const UPDATED_BY = "srgical";

type TrackerRowMatch = {
  rowLineIndex: number;
  cells: string[];
  statusColumnIndex: number;
  notesColumnIndex: number;
};

export type UnblockTrackerResult = {
  stepId: string;
  previousStatus: string;
  nextRecommendedBefore: string | null;
  nextRecommendedAfter: string;
  trackerPath: string;
};

export async function unblockTrackerStep(
  workspaceRoot: string,
  options: PlanningPathOptions & {
    requestedStepId?: string | null;
    reason?: string;
  } = {}
): Promise<UnblockTrackerResult> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const tracker = await readText(paths.tracker);
  const currentNext = readCurrentPositionValue(tracker, "Next Recommended");
  const stepId = normalizeStepId(options.requestedStepId) ?? normalizeStepId(currentNext);

  if (!stepId) {
    throw new Error("Tracker does not expose a `Next Recommended` step. Specify `/unblock <STEP_ID>`.");
  }

  const rowMatch = findStepRow(tracker, stepId);
  if (!rowMatch) {
    throw new Error(`Could not find tracker row for \`${stepId}\`.`);
  }

  const previousStatus = rowMatch.cells[rowMatch.statusColumnIndex]?.trim().toLowerCase() ?? "";
  if (previousStatus !== "blocked") {
    throw new Error(`\`${stepId}\` is not blocked (current status: ${previousStatus || "unknown"}).`);
  }

  rowMatch.cells[rowMatch.statusColumnIndex] = "pending";
  const reason = options.reason?.trim();
  const existingNotes = rowMatch.cells[rowMatch.notesColumnIndex]?.trim() ?? "";
  const unblockNote = reason
    ? `unblock retry requested (${new Date().toISOString()}) - ${reason}`
    : `unblock retry requested (${new Date().toISOString()})`;
  rowMatch.cells[rowMatch.notesColumnIndex] = mergeNotes(existingNotes, unblockNote);

  const lines = tracker.replace(/\r\n/g, "\n").split("\n");
  lines[rowMatch.rowLineIndex] = renderTableRow(rowMatch.cells);

  let updated = lines.join("\n");
  updated = writeCurrentPositionValue(updated, "Next Recommended", stepId);
  updated = writeCurrentPositionValue(updated, "Updated At", new Date().toISOString());
  updated = writeCurrentPositionValue(updated, "Updated By", UPDATED_BY);

  await writeText(paths.tracker, updated);

  return {
    stepId,
    previousStatus,
    nextRecommendedBefore: normalizeStepId(currentNext),
    nextRecommendedAfter: stepId,
    trackerPath: paths.tracker
  };
}

function findStepRow(tracker: string, stepId: string): TrackerRowMatch | null {
  const lines = tracker.replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";

    if (!isTableRow(line)) {
      continue;
    }

    const separator = lines[index + 1]?.trim() ?? "";
    if (!isTableSeparator(separator)) {
      continue;
    }

    const headers = splitTableCells(line).map(normalizeHeader);
    const idColumnIndex = headers.indexOf("id");
    const statusColumnIndex = headers.indexOf("status");
    const notesColumnIndex = headers.indexOf("notes");

    if (idColumnIndex < 0 || statusColumnIndex < 0 || notesColumnIndex < 0) {
      continue;
    }

    index += 2;
    while (index < lines.length) {
      const rowLine = lines[index]?.trim() ?? "";
      if (!isTableRow(rowLine)) {
        index -= 1;
        break;
      }

      const cells = splitTableCells(rowLine);
      const rowId = normalizeStepId(cells[idColumnIndex]) ?? "";

      if (rowId.toLowerCase() === stepId.toLowerCase()) {
        return {
          rowLineIndex: index,
          cells,
          statusColumnIndex,
          notesColumnIndex
        };
      }

      index += 1;
    }
  }

  return null;
}

function readCurrentPositionValue(tracker: string, label: string): string | null {
  const match = tracker.match(new RegExp(`- ${escapeRegExp(label)}: (?:\\\`([^\\\`]+)\\\`|([^\\n]+))`));
  return match?.[1]?.trim() ?? match?.[2]?.trim() ?? null;
}

function writeCurrentPositionValue(tracker: string, label: string, value: string): string {
  const withBackticks = value.toLowerCase() === "none queued" ? value : `\`${value}\``;
  const expression = new RegExp(`- ${escapeRegExp(label)}: (?:\\\`[^\\\`]*\\\`|[^\\n]*)`);

  if (!expression.test(tracker)) {
    return tracker;
  }

  return tracker.replace(expression, `- ${label}: ${withBackticks}`);
}

function mergeNotes(existing: string, appended: string): string {
  if (!existing) {
    return appended;
  }

  if (existing.toLowerCase().includes("unblock retry requested")) {
    return existing;
  }

  return `${existing}; ${appended}`;
}

function renderTableRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell.trim()).join(" | ")} |`;
}

function isTableRow(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|");
}

function isTableSeparator(line: string): boolean {
  return /^\|(?:\s*:?-+:?\s*\|)+$/.test(line);
}

function splitTableCells(line: string): string[] {
  const trimmed = line.slice(1, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeStepId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "none queued") {
    return null;
  }

  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
