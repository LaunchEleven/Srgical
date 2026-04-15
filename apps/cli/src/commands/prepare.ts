import { ensurePreparePack } from "../core/prepare-pack";
import { resolveWorkspace } from "../core/workspace";
import { launchStudio } from "../ui/studio";
import { launchWebStudio } from "../ui/web-studio";

export async function runPrepareCommand(
  workspaceArg?: string,
  options: {
    planId?: string | null;
    renderer?: "web" | "terminal" | null;
    openBrowser?: boolean;
  } = {}
): Promise<void> {
  const workspace = resolveWorkspace(workspaceArg);
  if (!options.planId || options.planId.trim().length === 0) {
    throw new Error("`srgical prepare` requires a named plan. Use `srgical prepare <id>` or `srgical prepare --plan <id>`.");
  }

  await ensurePreparePack(workspace, { planId: options.planId });
  if (options.renderer !== "terminal") {
    try {
      await launchWebStudio({
        workspace,
        planId: options.planId,
        mode: "prepare",
        openBrowser: options.openBrowser
      });
      return;
    } catch (error) {
      if (options.renderer === "web") {
        throw error;
      }
    }
  }
  await launchStudio({ workspace, planId: options.planId, mode: "prepare" });
}
