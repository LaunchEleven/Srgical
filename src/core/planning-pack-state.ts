import { loadExecutionState, type ExecutionState } from "./execution-state";
import { planningPackExists, readText } from "./workspace";
import { getPlanningPackPaths } from "./workspace";

export type PlanningCurrentPosition = {
  lastCompleted: string | null;
  nextRecommended: string | null;
  updatedAt: string | null;
};

export type PlanningStepSummary = {
  id: string;
  status: string;
  dependsOn: string;
  scope: string;
  acceptance: string;
  notes: string;
  phase: string | null;
};

export type PlanningPackState = {
  packPresent: boolean;
  trackerReadable: boolean;
  currentPosition: PlanningCurrentPosition;
  nextStepSummary: PlanningStepSummary | null;
  lastExecution: ExecutionState | null;
};

export async function readPlanningPackState(workspaceRoot: string): Promise<PlanningPackState> {
  const packPresent = await planningPackExists(workspaceRoot);
  const currentPosition = emptyCurrentPosition();
  let nextStepSummary: PlanningStepSummary | null = null;
  let trackerReadable = false;

  if (packPresent) {
    try {
      const tracker = await readText(getPlanningPackPaths(workspaceRoot).tracker);
      Object.assign(currentPosition, parseCurrentPosition(tracker));
      nextStepSummary = parseNextStepSummary(tracker, currentPosition.nextRecommended);
      trackerReadable = currentPosition.lastCompleted !== null || currentPosition.nextRecommended !== null;
    } catch {
      trackerReadable = false;
    }
  }

  const lastExecution = await loadExecutionState(workspaceRoot);

  return {
    packPresent,
    trackerReadable,
    currentPosition,
    nextStepSummary,
    lastExecution
  };
}

function parseCurrentPosition(tracker: string): PlanningCurrentPosition {
  return {
    lastCompleted: readCurrentPositionValue(tracker, "Last Completed"),
    nextRecommended: readCurrentPositionValue(tracker, "Next Recommended"),
    updatedAt: readCurrentPositionValue(tracker, "Updated At")
  };
}

function readCurrentPositionValue(tracker: string, label: string): string | null {
  const match = tracker.match(new RegExp(`- ${escapeRegExp(label)}: \`([^\`]+)\``));
  return match?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNextStepSummary(tracker: string, stepId: string | null): PlanningStepSummary | null {
  if (!stepId) {
    return null;
  }

  const rows = parseTrackerRows(tracker);
  return rows.find((row) => row.id === stepId) ?? null;
}

function parseTrackerRows(tracker: string): PlanningStepSummary[] {
  const lines = tracker.split(/\r?\n/);
  const rows: PlanningStepSummary[] = [];
  let currentPhase: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line.startsWith("## ")) {
      currentPhase = line.slice(3).trim();
      continue;
    }

    if (!isTableRow(line) || index + 1 >= lines.length || !isTableSeparator(lines[index + 1].trim())) {
      continue;
    }

    const headers = splitTableCells(line);
    index += 2;

    while (index < lines.length && isTableRow(lines[index].trim())) {
      const cells = splitTableCells(lines[index].trim());
      const row = buildTrackerRow(headers, cells, currentPhase);

      if (row) {
        rows.push(row);
      }

      index += 1;
    }

    index -= 1;
  }

  return rows;
}

function buildTrackerRow(headers: string[], cells: string[], phase: string | null): PlanningStepSummary | null {
  const values = new Map<string, string>();

  headers.forEach((header, index) => {
    values.set(normalizeHeader(header), cells[index] ?? "");
  });

  const id = values.get("id") ?? "";

  if (!id) {
    return null;
  }

  return {
    id,
    status: values.get("status") ?? "",
    dependsOn: values.get("depends_on") ?? "",
    scope: values.get("scope") ?? "",
    acceptance: values.get("acceptance") ?? "",
    notes: values.get("notes") ?? "",
    phase
  };
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

function emptyCurrentPosition(): PlanningCurrentPosition {
  return {
    lastCompleted: null,
    nextRecommended: null,
    updatedAt: null
  };
}
