import { buildLegacyWorkflowError } from "../core/workspace";

export async function runStudioConfigCommand(): Promise<void> {
  throw buildLegacyWorkflowError("srgical operate <id> --checkpoint");
}
