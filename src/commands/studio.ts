import { launchStudio } from "../ui/studio";

export async function runStudioCommand(
  workspaceArg?: string,
  options: {
    planId?: string | null;
  } = {}
): Promise<void> {
  await launchStudio({ workspace: workspaceArg, planId: options.planId });
}
