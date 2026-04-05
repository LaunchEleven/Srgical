import { buildLegacyWorkflowError } from "../core/workspace";

export async function runStudioCommand(): Promise<void> {
  throw buildLegacyWorkflowError("srgical prepare <id>");
}

export async function runStudioPlanCommand(): Promise<void> {
  throw buildLegacyWorkflowError("srgical prepare <id>");
}

export async function runStudioOperateCommand(): Promise<void> {
  throw buildLegacyWorkflowError("srgical operate <id>");
}
