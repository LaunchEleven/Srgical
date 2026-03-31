import { launchStudio, type StudioMode } from "../ui/studio";

export async function runStudioCommand(
  workspaceArg?: string,
  options: {
    planId?: string | null;
    mode?: StudioMode;
  } = {}
): Promise<void> {
  await launchStudio({
    workspace: workspaceArg,
    planId: options.planId,
    mode: options.mode ?? "plan"
  });
}

export async function runStudioPlanCommand(
  workspaceArg?: string,
  options: {
    planId?: string | null;
  } = {}
): Promise<void> {
  await runStudioCommand(workspaceArg, {
    planId: options.planId,
    mode: "plan"
  });
}

export async function runStudioOperateCommand(
  workspaceArg?: string,
  options: {
    planId?: string | null;
  } = {}
): Promise<void> {
  await runStudioCommand(workspaceArg, {
    planId: options.planId,
    mode: "operate"
  });
}
