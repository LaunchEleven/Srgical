import { loadPlanningAdviceState, type PlanningAdviceState } from "./advice-state";
import { loadAutoRunState, type AutoRunState } from "./auto-run-state";
import { loadExecutionState, type ExecutionState } from "./execution-state";
import { readPlanningPackDocumentSummary } from "./planning-doc-state";
import { formatPlanStage, loadPlanManifest, type PlanManifest } from "./plan-manifest";
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
import { getPlanningPackPaths, legacyPlanningPackExists, planningPackExists, readText, type PlanningPathOptions } from "./workspace";

export type PlanningCurrentPosition = {
  lastCompleted: string | null;
  nextRecommended: string | null;
  updatedAt: string | null;
};

export type PlanningStepSummary = {
  id: string;
  type: string;
  status: string;
  dependsOn: string;
  scope: string;
  acceptance: string;
  validation: string;
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

export type PlanningMode = "No Pack" | "Discover" | "Prepare" | "Ready" | "Execute" | "Blocked" | "Finished" | "Out of Date" | "Auto Running";

export type PlanningPackState = {
  planId: string;
  packDir: string;
  packPresent: boolean;
  legacyPackPresent: boolean;
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
  manifest: PlanManifest | null;
  evidence: string[];
  unknowns: string[];
  nextAction: string;
};

export async function readPlanningPackState(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<PlanningPackState> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const [packPresent, legacyPackPresent, lastExecution, planningState, advice, autoRun, studioSession, manifest] = await Promise.all([
    planningPackExists(workspaceRoot, options),
    legacyPlanningPackExists(workspaceRoot, options),
    loadExecutionState(workspaceRoot, options),
    loadPlanningState(workspaceRoot, options),
    loadPlanningAdviceState(workspaceRoot, options),
    loadAutoRunState(workspaceRoot, options),
    loadStudioSessionState(workspaceRoot, options),
    loadPlanManifest(workspaceRoot, options)
  ]);

  const currentPosition = emptyCurrentPosition();
  let nextStepSummary: PlanningStepSummary | null = null;
  let remainingExecutionSteps = 0;
  let trackerReadable = false;
  let trackerRows: PlanningStepSummary[] = [];

  if (packPresent) {
    try {
      const tracker = await readText(paths.tracker);
      trackerRows = parseTrackerRows(tracker);
      Object.assign(currentPosition, parseCurrentPosition(tracker));
      nextStepSummary = parseNextStepSummary(trackerRows, currentPosition.nextRecommended);
      remainingExecutionSteps = countRemainingExecutionSteps(trackerRows, currentPosition.nextRecommended);
      trackerReadable = currentPosition.lastCompleted !== null || currentPosition.nextRecommended !== null || trackerRows.length > 0;
    } catch {
      trackerReadable = false;
    }
  }

  const fallbackPackMode = planningState?.packMode ?? inferLegacyPackMode(currentPosition);
  const planningDocs = await readPlanningPackDocumentSummary(paths, fallbackPackMode === "authored" ? "grounded" : "boilerplate");
  const manifestPresent = packPresent && manifest ? 1 : 0;
  const docsPresent = planningDocs.groundedCount + manifestPresent;
  const draftState = planningState?.draftState ?? (fallbackPackMode === "authored" ? "written" : "scaffolded");
  const readiness = buildReadiness(studioSession.messages, nextStepSummary, {
    packMode: fallbackPackMode,
    docsPresent
  });
  const packMode = fallbackPackMode;
  const humanWriteConfirmed = hasHumanWriteConfirmation(planningState);
  const approvalStatus = planningState?.approvalStatus ?? "pending";
  const executionActivated = Boolean(lastExecution || (autoRun && autoRun.status !== "idle") || (nextStepSummary && currentPosition.lastCompleted !== "DISCOVER-001"));
  const mode = derivePlanningMode({
    packPresent,
    approvalStatus,
    nextStepSummary,
    autoRun,
    executionActivated,
    manifest
  });
  const nextAction = manifest?.nextAction ?? advice?.nextAction ?? defaultNextAction(mode);

  return {
    planId: paths.planId,
    packDir: paths.relativeDir,
    packPresent,
    legacyPackPresent,
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
    hasFailureOverlay: lastExecution?.status === "failure",
    manifest,
    evidence: manifest?.evidence ?? [],
    unknowns: manifest?.unknowns ?? [],
    nextAction
  };
}

export function isExecutionStepSummary(step: PlanningStepSummary | null): boolean {
  if (!step) {
    return false;
  }

  const status = step.status.trim().toLowerCase();
  return status === "todo" || status === "doing";
}

export function isExecutionReadyState(state: PlanningPackState): boolean {
  return state.packPresent && state.approvalStatus === "approved" && isExecutionStepSummary(state.nextStepSummary);
}

function derivePlanningMode(input: {
  packPresent: boolean;
  approvalStatus: PlanningApprovalStatus;
  nextStepSummary: PlanningStepSummary | null;
  autoRun: AutoRunState | null;
  executionActivated: boolean;
  manifest: PlanManifest | null;
}): PlanningMode {
  if (!input.packPresent) {
    return "No Pack";
  }

  if (input.autoRun?.status === "running" || input.autoRun?.status === "stop_requested") {
    return "Auto Running";
  }

  if (input.manifest) {
    return formatPlanStage(input.manifest.stage) as PlanningMode;
  }

  if (input.approvalStatus === "stale") {
    return "Out of Date";
  }

  if (input.approvalStatus === "approved") {
    if (!input.nextStepSummary) {
      return "Finished";
    }

    if (input.nextStepSummary.status.toLowerCase() === "blocked") {
      return "Blocked";
    }

    return input.executionActivated ? "Execute" : "Ready";
  }

  return "Prepare";
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
    /(^|\b)(yes|agreed|approved|go with that|use that|let'?s do that|build the draft|write (it|that|the draft)|capture that|lock it in|sounds right|that seam works)\b/.test(
      userTranscript
    );
  const checks: PlanningReadinessCheck[] = [
    {
      id: "goal",
      label: "Desired outcome captured",
      passed: userMessages.some((message) => message.content.trim().length >= 12)
    },
    {
      id: "repo",
      label: "Repo context captured",
      passed: /repo|current|existing|already|codebase|today|currently|workspace|evidence|file/.test(transcript)
    },
    {
      id: "constraints",
      label: "Constraints or decisions captured",
      passed: /constraint|must|should|can't|cannot|need|require|decision|prefer|non-negotiable|confirmed/.test(transcript)
    },
    {
      id: "execution",
      label: "First safe slice captured",
      passed: Boolean(nextStepSummary) || /step|slice|execute|execution|implement|tracker|spike|validation/.test(transcript)
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
    substantiveAssistantMessages.length >= 1;
  const readyToWrite = readyForFirstDraft;
  const readyToDice = readyForFirstDraft && options.packMode === "authored";
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
    content.startsWith("Auto-gather") ||
    content.startsWith("/assess") ||
    content.startsWith("/gather") ||
    content.startsWith("/gaps") ||
    content.startsWith("/ready")
  );
}

function parseCurrentPosition(tracker: string): PlanningCurrentPosition {
  return {
    lastCompleted: readCurrentPositionValue(tracker, "Last completed") ?? readCurrentPositionValue(tracker, "Last Completed"),
    nextRecommended: normalizeStepReference(
      readCurrentPositionValue(tracker, "Next step") ?? readCurrentPositionValue(tracker, "Next Recommended")
    ),
    updatedAt: readCurrentPositionValue(tracker, "Updated at") ?? readCurrentPositionValue(tracker, "Updated At")
  };
}

function readCurrentPositionValue(tracker: string, label: string): string | null {
  const match = tracker.match(new RegExp(`- ${escapeRegExp(label)}: (?:\\\`([^\\\`]+)\\\`|([^\\n]+))`, "i"));
  return match?.[1]?.trim() ?? match?.[2]?.trim() ?? null;
}

function normalizeStepReference(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.toLowerCase() === "none queued" || value.toLowerCase() === "none" ? null : value;
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

  const nextIndex = rows.findIndex((row) => row.id === nextRecommended);
  const candidateRows = nextIndex >= 0 ? rows.slice(nextIndex) : rows;

  return candidateRows.filter((row) => !isTerminalExecutionStatus(row.status)).length;
}

function isTerminalExecutionStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "done" || normalized === "skipped";
}

export function parseTrackerRows(tracker: string): PlanningStepSummary[] {
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
    type: values.get("type") ?? "",
    status: values.get("status") ?? "",
    dependsOn: values.get("depends_on") ?? "",
    scope: values.get("scope") ?? "",
    acceptance: values.get("acceptance") ?? "",
    validation: values.get("validation") ?? "",
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

function defaultNextAction(mode: PlanningMode): string {
  switch (mode) {
    case "Discover":
      return "Gather more evidence or describe the outcome you want before building the first draft.";
    case "Prepare":
      return "Build or slice the draft, review the changes, then approve when the plan is clear.";
    case "Ready":
      return "Open operate and run the next step.";
    case "Execute":
    case "Auto Running":
      return "Keep execution focused on the next step and review what changed after each run.";
    case "Blocked":
      return "Resolve the blocker or reopen prepare to reshape the pending work.";
    case "Finished":
      return "Review the outcome or reopen prepare to extend the plan.";
    case "Out of Date":
      return "Review the updated draft and approve the new baseline before operating again.";
    case "No Pack":
      return "Create a prepare pack first.";
  }
}
