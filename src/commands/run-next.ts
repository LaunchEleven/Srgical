import { buildLegacyWorkflowError } from "../core/workspace";

export async function runRunNextCommand(): Promise<void> {
  throw buildLegacyWorkflowError("srgical operate <id>");
}
