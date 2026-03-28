import { loadAutoRunState, type AutoRunState } from "./auto-run-state";
import { loadExecutionState, type ExecutionState } from "./execution-state";
import { inferLegacyPackMode, loadPlanningState, type PlanningPackMode, type PlanningStateFile } from "./planning-state";
import { DEFAULT_STUDIO_MESSAGES, loadStudioSessionState } from "./studio-session";
import { fileExists, getPlanningPackPaths, planningPackExists, readText, type PlanningPathOptions } from "./workspace";

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

export type PlanningReadinessCheck = {
  id: "goal" | "repo" | "constraints" | "execution";
  label: string;
  passed: boolean;
};

export type PlanningReadiness = {
  checks: PlanningReadinessCheck[];
  score: number;
  total: number;
  readyToWrite: boolean;
  missingLabels: string[];
};

export type PlanningMode =
  | "No Pack"
  | "Gathering Context"
  | "Ready to Write"
  | "Plan Written - Needs Step"
  | "Ready to Execute"
  | "Execution Active"
  | "Auto Running";

export type PlanningPackState = {
  planId: string;
  packDir: string;
  packPresent: boolean;
  trackerReadable: boolean;
  docsPresent: number;
  currentPosition: PlanningCurrentPosition;
  nextStepSummary: PlanningStepSummary | null;
  lastExecution: ExecutionState | null;
  planningState: PlanningStateFile | null;
  packMode: PlanningPackMode;
  readiness: PlanningReadiness;
  autoRun: AutoRunState | null;
  executionActivated: boolean;
  mode: PlanningMode;
  hasFailureOverlay: boolean;
};

export async function readPlanningPackState(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<PlanningPackState> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const packPresent = await planningPackExists(workspaceRoot, options);
  const currentPosition = emptyCurrentPosition();
  let nextStepSummary: PlanningStepSummary | null = null;
  let trackerReadable = false;

  if (packPresent) {
    try {
      const tracker = await readText(paths.tracker);
      Object.assign(currentPosition, parseCurrentPosition(tracker));
      nextStepSummary = parseNextStepSummary(tracker, currentPosition.nextRecommended);
      trackerReadable = currentPosition.lastCompleted !== null || currentPosition.nextRecommended !== null;
    } catch {
      trackerReadable = false;
    }
  }

  const [lastExecution, planningState, autoRun, docsPresent, studioSession] = await Promise.all([
    loadExecutionState(workspaceRoot, options),
    loadPlanningState(workspaceRoot, options),
    loadAutoRunState(workspaceRoot, options),
    countPresentDocs(paths),
    loadStudioSessionState(workspaceRoot, options)
  ]);

  const readiness = buildReadiness(studioSession.messages, nextStepSummary);
  const packMode = planningState?.packMode ?? inferLegacyPackMode(currentPosition);
  const executionActivated = Boolean(
    lastExecution ||
      (autoRun && autoRun.status !== "idle") ||
      (isExecutionStepSummary(nextStepSummary) && currentPosition.lastCompleted !== "PLAN-001")
  );
  const mode = derivePlanningMode({
    packPresent,
    packMode,
    readiness,
    nextStepSummary,
    autoRun,
    executionActivated
  });

  return {
    planId: paths.planId,
    packDir: paths.relativeDir,
    packPresent,
    trackerReadable,
    docsPresent,
    currentPosition,
    nextStepSummary,
    lastExecution,
    planningState,
    packMode,
    readiness,
    autoRun,
    executionActivated,
    mode,
    hasFailureOverlay: lastExecution?.status === "failure"
  };
}

export function isExecutionStepSummary(step: PlanningStepSummary | null): boolean {
  if (!step) {
    return false;
  }

  const phase = step.phase?.toLowerCase() ?? "";
  return phase.includes("delivery") || phase.includes("execution") || /^exec[-\d]/i.test(step.id);
}

export function isExecutionReadyState(state: PlanningPackState): boolean {
  return state.packPresent && state.packMode === "authored" && isExecutionStepSummary(state.nextStepSummary);
}

function derivePlanningMode(input: {
  packPresent: boolean;
  packMode: PlanningPackMode;
  readiness: PlanningReadiness;
  nextStepSummary: PlanningStepSummary | null;
  autoRun: AutoRunState | null;
  executionActivated: boolean;
}): PlanningMode {
  if (!input.packPresent) {
    return "No Pack";
  }

  if (input.autoRun?.status === "running" || input.autoRun?.status === "stop_requested") {
    return "Auto Running";
  }

  if (input.packMode === "scaffolded") {
    return input.readiness.readyToWrite ? "Ready to Write" : "Gathering Context";
  }

  if (!isExecutionStepSummary(input.nextStepSummary)) {
    return "Plan Written - Needs Step";
  }

  return input.executionActivated ? "Execution Active" : "Ready to Execute";
}

function buildReadiness(messages: { role: "user" | "assistant" | "system"; content: string }[], nextStepSummary: PlanningStepSummary | null): PlanningReadiness {
  const meaningfulMessages = messages.filter((message) => message.content.trim().length > 0);
  const userMessages = meaningfulMessages.filter((message) => message.role === "user");
  const assistantMessages = meaningfulMessages.filter(
    (message) =>
      message.role === "assistant" &&
      !DEFAULT_STUDIO_MESSAGES.some((defaultMessage) => defaultMessage.content === message.content)
  );
  const substantiveUserMessages = userMessages.filter((message) => message.content.trim().length >= 48);
  const substantiveAssistantMessages = assistantMessages.filter((message) => message.content.trim().length >= 80);
  const userTranscript = userMessages.map((message) => message.content.toLowerCase()).join("\n");
  const transcript = meaningfulMessages.map((message) => message.content.toLowerCase()).join("\n");
  const checks: PlanningReadinessCheck[] = [
    {
      id: "goal",
      label: "Goal captured",
      passed: userMessages.length > 0
    },
    {
      id: "repo",
      label: "Repo context captured",
      passed: /repo|current|existing|already|codebase|today|currently|workspace/.test(transcript)
    },
    {
      id: "constraints",
      label: "Constraints or decisions captured",
      passed: /constraint|must|should|can't|cannot|need|require|locked|decision|prefer|non-negotiable/.test(transcript)
    },
    {
      id: "execution",
      label: "First executable slice captured",
      passed:
        isExecutionStepSummary(nextStepSummary) || /step|slice|execute|execution|implement|delivery|tracker/.test(transcript)
    }
  ];

  const score = checks.filter((check) => check.passed).length;
  const commitmentCaptured =
    /(^|\b)(yes|agreed|approved|go with that|use that|let'?s do that|write (it|that|the pack)|capture that|lock it in|sounds right|that seam works)\b/.test(
      userTranscript
    );
  const readyToWrite =
    score === checks.length &&
    substantiveUserMessages.length >= 2 &&
    substantiveAssistantMessages.length >= 2 &&
    commitmentCaptured;
  const missingLabels = checks.filter((check) => !check.passed).map((check) => check.label);

  if (!commitmentCaptured) {
    missingLabels.push("Explicit go-ahead captured");
  }

  return {
    checks,
    score,
    total: checks.length,
    readyToWrite,
    missingLabels
  };
}

async function countPresentDocs(paths: ReturnType<typeof getPlanningPackPaths>): Promise<number> {
  const checks = await Promise.all([
    fileExists(paths.plan),
    fileExists(paths.context),
    fileExists(paths.tracker),
    fileExists(paths.nextPrompt)
  ]);

  return checks.filter(Boolean).length;
}

function parseCurrentPosition(tracker: string): PlanningCurrentPosition {
  return {
    lastCompleted: readCurrentPositionValue(tracker, "Last Completed"),
    nextRecommended: normalizeStepReference(readCurrentPositionValue(tracker, "Next Recommended")),
    updatedAt: readCurrentPositionValue(tracker, "Updated At")
  };
}

function readCurrentPositionValue(tracker: string, label: string): string | null {
  const match = tracker.match(new RegExp(`- ${escapeRegExp(label)}: (?:\\\`([^\\\`]+)\\\`|([^\\n]+))`));
  return match?.[1]?.trim() ?? match?.[2]?.trim() ?? null;
}

function normalizeStepReference(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.toLowerCase() === "none queued" ? null : value;
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
