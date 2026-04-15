import { buildLegacyWorkflowError } from "../core/workspace";

export async function runInitCommand(): Promise<void> {
  throw buildLegacyWorkflowError("srgical prepare <id>");
}
