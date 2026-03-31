import process from "node:process";
import { savePlanningState } from "../core/planning-state";
import { getInitialTemplates } from "../core/templates";
import { ensurePlanningDir, planningPackExists, resolveWorkspace, saveActivePlanId, writeText } from "../core/workspace";
import { paintLine, renderCommandBanner, renderSectionHeading } from "../ui/terminal-theme";

export async function runInitCommand(workspaceArg?: string, force = false, planId?: string | null): Promise<void> {
  if (!planId || planId.trim().length === 0) {
    throw new Error("`srgical init` requires an explicit named plan. Use `srgical init --plan <id>`.");
  }

  const workspace = resolveWorkspace(workspaceArg);
  const exists = await planningPackExists(workspace, { planId });

  if (exists && !force) {
    throw new Error("A planning pack already exists for the selected plan. Re-run with --force to overwrite it.");
  }

  const paths = await ensurePlanningDir(workspace, { planId });
  const templates = getInitialTemplates(paths);

  await Promise.all(
    Object.entries(templates).map(([filePath, content]) => writeText(filePath, content))
  );
  await savePlanningState(workspace, "scaffolded", { planId: paths.planId });
  await saveActivePlanId(workspace, paths.planId);

  process.stdout.write(
    [
      ...renderCommandBanner("srgical", `init ${paths.planId}`),
      "",
      paintLine(`Created planning pack for plan \`${paths.planId}\` in ${paths.dir}`, "success", { bold: true }),
      "",
      renderSectionHeading("Files"),
      `- ${paths.plan}`,
      `- ${paths.context}`,
      `- ${paths.tracker}`,
      `- ${paths.nextPrompt}`,
      `- ${paths.handoff}`,
      "",
      renderSectionHeading("Next"),
      paintLine(`Next: run \`srgical doctor --plan ${paths.planId}\` or open \`srgical studio plan --plan ${paths.planId}\`.`, "brand", {
        bold: true
      })
    ].join("\n") + "\n"
  );
}
