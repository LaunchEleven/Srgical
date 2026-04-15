import { buildLegacyWorkflowError } from "../core/workspace";

export async function runDoctorCommand(): Promise<void> {
  throw buildLegacyWorkflowError("srgical status <id>");
}
