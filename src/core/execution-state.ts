import { appendFile } from "node:fs/promises";
import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

export type ExecutionOutcomeStatus = "success" | "failure";
export type ExecutionOutcomeSource = "studio" | "run-next";

export type ExecutionState = {
  version: 1;
  updatedAt: string;
  status: ExecutionOutcomeStatus;
  source: ExecutionOutcomeSource;
  summary: string;
};

export type ExecutionLogOptions = {
  stepLabel?: string | null;
};

export async function loadExecutionState(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<ExecutionState | null> {
  const paths = getPlanningPackPaths(workspaceRoot, options);
  const exists = await fileExists(paths.executionState);

  if (!exists) {
    return null;
  }

  try {
    const raw = await readText(paths.executionState);
    const parsed = JSON.parse(raw) as Partial<ExecutionState>;

    if (
      parsed.version !== 1 ||
      (parsed.status !== "success" && parsed.status !== "failure") ||
      (parsed.source !== "studio" && parsed.source !== "run-next") ||
      typeof parsed.updatedAt !== "string" ||
      typeof parsed.summary !== "string"
    ) {
      return null;
    }

    return {
      version: 1,
      updatedAt: parsed.updatedAt,
      status: parsed.status,
      source: parsed.source,
      summary: parsed.summary
    };
  } catch {
    return null;
  }
}

export async function saveExecutionState(
  workspaceRoot: string,
  status: ExecutionOutcomeStatus,
  source: ExecutionOutcomeSource,
  summary: string,
  options: PlanningPathOptions = {}
): Promise<void> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const payload: ExecutionState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    status,
    source,
    summary: normalizeSummary(summary)
  };

  await writeText(paths.executionState, JSON.stringify(payload, null, 2));
}

export async function appendExecutionLog(
  workspaceRoot: string,
  status: ExecutionOutcomeStatus,
  source: ExecutionOutcomeSource,
  summary: string,
  options: ExecutionLogOptions & PlanningPathOptions = {}
): Promise<void> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const entry = buildExecutionLogEntry(status, source, summary, options);
  const exists = await fileExists(paths.executionLog);

  if (!exists) {
    await writeText(paths.executionLog, buildExecutionLogHeader());
  }

  await appendFile(paths.executionLog, entry, "utf8");
}

function normalizeSummary(summary: string): string {
  const compact = summary.replace(/\s+/g, " ").trim();
  if (compact.length <= 180) {
    return compact;
  }

  return `${compact.slice(0, 177)}...`;
}

function buildExecutionLogHeader(): string {
  return [
    "# Execution Log",
    "",
    "Durable execution history for `.srgical/` runs. Each entry records when a run happened, its final status, and a",
    "concise summary for review and debugging.",
    ""
  ].join("\n");
}

function buildExecutionLogEntry(
  status: ExecutionOutcomeStatus,
  source: ExecutionOutcomeSource,
  summary: string,
  options: ExecutionLogOptions
): string {
  const timestamp = new Date().toISOString();
  const lines = [`## ${timestamp} - ${source} - ${status}`, ""];

  if (options.stepLabel) {
    lines.push(`- Step: ${options.stepLabel}`);
  }

  lines.push(`- Summary: ${normalizeLogSummary(summary)}`, "");
  return `${lines.join("\n")}\n`;
}

function normalizeLogSummary(summary: string): string {
  const compact = summary.replace(/\s+/g, " ").trim();

  if (compact.length <= 400) {
    return compact;
  }

  return `${compact.slice(0, 397)}...`;
}
