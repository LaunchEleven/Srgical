import { launchStudio } from "../ui/studio";

export async function runStudioCommand(workspaceArg?: string): Promise<void> {
  await launchStudio({ workspace: workspaceArg });
}
