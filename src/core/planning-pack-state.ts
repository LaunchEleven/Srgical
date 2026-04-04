import { loadPlanningAdviceState, type PlanningAdviceState } from "./advice-state";
import { loadAutoRunState, type AutoRunState } from "./auto-run-state";
import { readPlanningPackDocumentSummary } from "./planning-doc-state";
import { loadExecutionState, type ExecutionState } from "./execution-state";
import {
  hasHumanWriteConfirmation,
  inferLegacyPackMode,
  loadPlanningState,
  type PlanningApprovalInvalidationReason,
  type PlanningApprovalStatus,
  type PlanningDraftState,
  type PlanningPackMode,
  type PlanningStateFile
} from "./planning-state";
import { DEFAULT_STUDIO_MESSAGES, loadStudioSessionState } from "./studio-session";
import { getPlanningPackPaths, planningPackExists, readText, type PlanningPathOptions } from "./workspace";

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
  id: "goal" | "repo" | "constraints" | "execution" | "approval";
  label: string;
  passed: boolean;
};

export type PlanningReadiness = {
  checks: PlanningReadinessCheck[];
  score: number;
  total: number;
  approvalCaptured: boolean;
  readyForFirstDraft: boolean;
  readyToWrite: boolean;
  readyToDice: boolean;
  readyToApprove: boolean;
  missingLabels: string[];
};

export type PlanningMode =
  | "No Pack"
  | "Gathering Context"
  | "Ready to Draft"
  | "Draft Written"
  | "Sliced Draft"
  | "Approved"
  | "Approved - Stale"
  | "Ready to Execute"
  | "Execution Active"
  | "Auto Running";

export type PlanningPackState = {
  planId: string;
  packDir: string;
  packPresent: boolean;
  trackerReadable: boolean;
  docsPresent: number;
  remainingExecutionSteps: number;
  currentPosition: PlanningCurrentPosition;
  nextStepSummary: PlanningStepSummary | null;
  lastExecution: ExecutionState | null;
  planningState: PlanningStateFile | null;
  packMode: PlanningPackMode;
  draftState: PlanningDraftState;
  readiness: PlanningReadiness;
  humanWriteConfirmed: boolean;
  humanWriteConfirmedAt: string | null;
  approvalStatus: PlanningApprovalStatus;
  approvalInvalidatedBy: PlanningApprovalInvalidationReason | null;
  lastWriteAt: string | null;
  lastDiceAt: string | null;
  advice: PlanningAdviceState | null;
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
  let remainingExecutionSteps = 0;
  let trackerReadable = false;

  if (packPresent) {
    try {
      const tracker = await readText(paths.tracker);
      const trackerRows = parseTrackerRows(tracker);
      Object.assign(currentPosition, parseCurrentPosition(tracker));
      nextStepSummary = parseNextStepSummary(trackerRows, currentPosition.nextRecommended);
      remainingExecutionSteps = countRemainingExecutionSteps(trackerRows, currentPosition.nextRecommended);
      trackerReadable = currentPosition.lastCompleted !== null || currentPosition.nextRecommended !== null;
    } catch {
      trackerReadable = false;
    }
  }

  const [lastExecution, planningState, advice, autoRun, studioSession] = await Promise.all([
    loadExecutionState(workspaceRoot, options),
    loadPlanningState(workspaceRoot, options),
    loadPlanningAdviceState(workspaceRoot, options),
    loadAutoRunState(workspaceRoot, options),
    loadStudioSessionState(workspaceRoot, options)
  ]);
  const fallbackPackMode = planningState?.packMode ?? inferLegacyPackMode(currentPosition);
  const planningDocs = await readPlanningPackDocumentSummary(paths, fallbackPackMode === "authored" ? "grounded" : "boilerplate");

  const docsPresent = planningDocs.groundedCount;
  const draftState = planningState?.draftState ?? (fallbackPackMode === "authored" ? "written" : "scaffolded");
  const readiness = buildReadiness(studioSession.messages, nextStepSummary, {
    packMode: fallbackPackMode,
    docsPresent
  });
  const packMode = fallbackPackMode;
  const humanWriteConfirmed = hasHumanWriteConfirmation(planningState);
  const approvalStatus = planningState?.approvalStatus ?? "pending";
  const executionActivated = Boolean(
    lastExecution ||
      (autoRun && autoRun.status !== "idle") ||
      (isExecutionStepSummary(nextStepSummary) && currentPosition.lastCompleted !== "PLAN-001")
  );
  const mode = derivePlanningMode({
    packPresent,
    packMode,
    draftState,
    approvalStatus,
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
    remainingExecutionSteps,
    currentPosition,
    nextStepSummary,
    lastExecution,
    planningState,
    packMode,
    draftState,
    readiness,
    humanWriteConfirmed,
    humanWriteConfirmedAt: planningState?.humanConfirmedForWriteAt ?? null,
    approvalStatus,
    approvalInvalidatedBy: planningState?.approvalInvalidatedBy ?? null,
    lastWriteAt: planningState?.lastWriteAt ?? null,
    lastDiceAt: planningState?.lastDiceAt ?? null,
    advice,
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
  return state.packPresent && state.approvalStatus === "approved" && isExecutionStepSummary(state.nextStepSummary);
}

function derivePlanningMode(input: {
  packPresent: boolean;
  packMode: PlanningPackMode;
  draftState: PlanningDraftState;
  approvalStatus: PlanningApprovalStatus;
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
    return input.readiness.readyToWrite ? "Ready to Draft" : "Gathering Context";
  }

  if (input.approvalStatus === "stale") {
    return "Approved - Stale";
  }

  if (input.approvalStatus === "approved") {
    if (isExecutionStepSummary(input.nextStepSummary)) {
      return input.executionActivated ? "Execution Active" : "Ready to Execute";
    }

    return "Approved";
  }

  return input.draftState === "sliced" ? "Sliced Draft" : "Draft Written";
}

function buildReadiness(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  nextStepSummary: PlanningStepSummary | null,
  options: { packMode: PlanningPackMode; docsPresent: number }
): PlanningReadiness {
  const meaningfulMessages = messages.filter((message) => message.content.trim().length > 0);
  const effectiveMessages = meaningfulMessages.filter((message) => {
    if (message.role === "assistant") {
      return !DEFAULT_STUDIO_MESSAGES.some((defaultMessage) => defaultMessage.content === message.content);
    }

    if (message.role === "system") {
      return isContextBearingSystemMessage(message.content);
    }

    return true;
  });
  const userMessages = effectiveMessages.filter((message) => message.role === "user");
  const assistantMessages = effectiveMessages.filter((message) => message.role === "assistant");
  const substantiveUserMessages = userMessages.filter((message) => message.content.trim().length >= 48);
  const substantiveAssistantMessages = assistantMessages.filter((message) => message.content.trim().length >= 80);
  const userTranscript = userMessages.map((message) => message.content.toLowerCase()).join("\n");
  const transcript = effectiveMessages.map((message) => message.content.toLowerCase()).join("\n");
  const commitmentCaptured =
    /(^|\b)(yes|agreed|approved|go with that|use that|let'?s do that|write (it|that|the pack|the draft)|capture that|lock it in|sounds right|that seam works)\b/.test(
      userTranscript
    );
  const checks: PlanningReadinessCheck[] = [
    {
      id: "goal",
      label: "Goal captured",
      passed: userMessages.some((message) => message.content.trim().length >= 12)
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
    },
    {
      id: "approval",
      label: "Explicit go-ahead captured",
      passed: commitmentCaptured
    }
  ];

  const score = checks.filter((check) => check.passed).length;
  const readyForFirstDraft =
    checks.filter((check) => check.id !== "approval").every((check) => check.passed) &&
    substantiveUserMessages.length >= 2 &&
    substantiveAssistantMessages.length >= 2;
  const readyToWrite = readyForFirstDraft;
  const readyToDice = readyForFirstDraft && (options.packMode === "authored" || options.docsPresent > 0);
  const readyToApprove = options.packMode === "authored" && options.docsPresent > 0;
  const missingLabels = checks.filter((check) => !check.passed).map((check) => check.label);

  return {
    checks,
    score,
    total: checks.length,
    approvalCaptured: commitmentCaptured,
    readyForFirstDraft,
    readyToWrite,
    readyToDice,
    readyToApprove,
    missingLabels
  };
}

function isContextBearingSystemMessage(content: string): boolean {
  return (
    content.startsWith("Reading ") ||
    content.startsWith("Loaded context file:") ||
    content.includes("===== BEGIN FILE ") ||
    content.startsWith("/assess") ||
    content.startsWith("/gather") ||
    content.startsWith("/gaps") ||
    content.startsWith("/ready")
  );
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

function parseNextStepSummary(rows: PlanningStepSummary[], stepId: string | null): PlanningStepSummary | null {
  if (!stepId) {
    return null;
  }

  return rows.find((row) => row.id === stepId) ?? null;
}

function countRemainingExecutionSteps(rows: PlanningStepSummary[], nextRecommended: string | null): number {
  if (!nextRecommended) {
    return 0;
  }

  const executionRows = rows.filter((row) => isExecutionStepSummary(row));
  const nextIndex = executionRows.findIndex((row) => row.id === nextRecommended);
  const candidateRows = nextIndex >= 0 ? executionRows.slice(nextIndex) : executionRows;

  return candidateRows.filter((row) => !isTerminalExecutionStatus(row.status)).length;
}

function isTerminalExecutionStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "done" || normalized === "completed" || normalized === "complete" || normalized === "skipped";
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
