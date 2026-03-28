import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

export type AdviceClarity = "clear" | "mostly clear" | "still fuzzy";

export type PlanningAdviceState = {
  version: 1;
  planId: string;
  updatedAt: string;
  problemStatement: string;
  clarity: AdviceClarity;
  stateAssessment: string;
  researchNeeded: string[];
  advice: string;
  nextAction: string;
};

export async function loadPlanningAdviceState(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<PlanningAdviceState | null> {
  const paths = getPlanningPackPaths(workspaceRoot, options);

  if (!(await fileExists(paths.adviceState))) {
    return null;
  }

  try {
    return normalizePlanningAdvice(JSON.parse(await readText(paths.adviceState)), paths.planId);
  } catch {
    return null;
  }
}

export async function savePlanningAdviceState(
  workspaceRoot: string,
  advice: Omit<PlanningAdviceState, "version" | "planId" | "updatedAt">,
  options: PlanningPathOptions = {}
): Promise<PlanningAdviceState> {
  const paths = await ensurePlanningDir(workspaceRoot, options);
  const payload: PlanningAdviceState = {
    version: 1,
    planId: paths.planId,
    updatedAt: new Date().toISOString(),
    ...advice
  };

  await writeText(paths.adviceState, JSON.stringify(payload, null, 2));
  return payload;
}

export function normalizePlanningAdvice(value: unknown, fallbackPlanId: string): PlanningAdviceState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PlanningAdviceState>;
  const clarity = normalizeClarity(candidate.clarity);

  if (
    candidate.version !== 1 ||
    typeof candidate.problemStatement !== "string" ||
    !clarity ||
    typeof candidate.stateAssessment !== "string" ||
    !Array.isArray(candidate.researchNeeded) ||
    candidate.researchNeeded.some((item) => typeof item !== "string") ||
    typeof candidate.advice !== "string" ||
    typeof candidate.nextAction !== "string"
  ) {
    return null;
  }

  return {
    version: 1,
    planId: typeof candidate.planId === "string" ? candidate.planId : fallbackPlanId,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
    problemStatement: candidate.problemStatement.trim(),
    clarity,
    stateAssessment: candidate.stateAssessment.trim(),
    researchNeeded: candidate.researchNeeded.map((item) => item.trim()).filter(Boolean),
    advice: candidate.advice.trim(),
    nextAction: candidate.nextAction.trim()
  };
}

export function parsePlanningAdviceResponse(raw: string, fallbackPlanId: string): PlanningAdviceState | null {
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return null;
  }

  try {
    return normalizePlanningAdvice(JSON.parse(raw.slice(jsonStart, jsonEnd + 1)), fallbackPlanId);
  } catch {
    return null;
  }
}

function normalizeClarity(value: unknown): AdviceClarity | null {
  if (value === "clear" || value === "mostly clear" || value === "still fuzzy") {
    return value;
  }

  return null;
}
