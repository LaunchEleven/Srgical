import { parsePlanningAdviceResponse, savePlanningAdviceState, type PlanningAdviceState } from "./advice-state";
import { requestPlanningAdvice } from "./agent";
import { readPlanningPackState } from "./planning-pack-state";
import type { ChatMessage } from "./prompts";
import type { PlanningPathOptions } from "./workspace";

export async function refreshPlanningAdvice(
  workspaceRoot: string,
  messages: ChatMessage[],
  options: PlanningPathOptions = {}
): Promise<PlanningAdviceState> {
  const packState = await readPlanningPackState(workspaceRoot, options);
  const raw = await requestPlanningAdvice(workspaceRoot, messages, packState, options);
  const parsed = parsePlanningAdviceResponse(raw, packState.planId);

  if (!parsed) {
    throw new Error("Planning advice could not be parsed from the active agent response.");
  }

  return savePlanningAdviceState(
    workspaceRoot,
    {
      problemStatement: parsed.problemStatement,
      clarity: parsed.clarity,
      stateAssessment: parsed.stateAssessment,
      researchNeeded: parsed.researchNeeded,
      advice: parsed.advice,
      nextAction: parsed.nextAction
    },
    options
  );
}
