import process from "node:process";
import {
  loadStudioOperateConfig,
  loadStudioOperateGuidanceSnapshot,
  sanitizeReferencePaths,
  saveStudioOperateConfig
} from "../core/studio-operate-config";
import { getPlanningPackPaths, resolvePlanId, resolveWorkspace, saveActivePlanId } from "../core/workspace";
import { paintLine, renderCommandBanner, renderSectionHeading } from "../ui/terminal-theme";

type StudioConfigCommandOptions = {
  planId?: string | null;
  pausePr?: boolean;
  setReference?: string[];
  addReference?: string[];
  clearReferences?: boolean;
};

export async function runStudioConfigCommand(workspaceArg?: string, options: StudioConfigCommandOptions = {}): Promise<void> {
  const workspace = resolveWorkspace(workspaceArg);
  const planId = await resolvePlanId(workspace, options.planId);
  await saveActivePlanId(workspace, planId);

  const current = await loadStudioOperateConfig(workspace, { planId });
  const hasSetReferences = Boolean(options.setReference && options.setReference.length > 0);
  const hasAddReferences = Boolean(options.addReference && options.addReference.length > 0);
  const hasEdits = options.pausePr !== undefined || hasSetReferences || hasAddReferences || Boolean(options.clearReferences);

  let referencePaths = [...current.referencePaths];
  if (options.clearReferences) {
    referencePaths = [];
  }

  if (hasSetReferences) {
    referencePaths = [...(options.setReference ?? [])];
  }

  if (hasAddReferences) {
    referencePaths = [...referencePaths, ...(options.addReference ?? [])];
  }

  const savedConfig = hasEdits
    ? await saveStudioOperateConfig(
        workspace,
        {
          pauseForPr: options.pausePr ?? current.pauseForPr,
          referencePaths: sanitizeReferencePaths(referencePaths)
        },
        { planId }
      )
    : current;
  const guidanceSnapshot = await loadStudioOperateGuidanceSnapshot(workspace, { planId });
  const paths = getPlanningPackPaths(workspace, { planId });

  const lines = [
    ...renderCommandBanner("srgical", `studio config ${planId}`),
    "",
    renderSectionHeading("Mode"),
    hasEdits
      ? paintLine(`Saved studio operate config for plan \`${planId}\`.`, "success", { bold: true })
      : paintLine(`Showing studio operate config for plan \`${planId}\`.`, "info"),
    "",
    renderSectionHeading("Config"),
    `Workspace: ${workspace}`,
    `Plan dir: ${paths.relativeDir}`,
    `Config file: ${paths.studioOperateConfig}`,
    `Pause for PR: ${savedConfig.pauseForPr ? "enabled" : "disabled"}`,
    `Reference paths configured: ${savedConfig.referencePaths.length}`,
    ...(savedConfig.referencePaths.length > 0
      ? savedConfig.referencePaths.map((referencePath) => `- ${referencePath}`)
      : ["- none"]),
    "",
    renderSectionHeading("Guidance"),
    `Loaded reference docs this run: ${guidanceSnapshot.docs.length}`,
    ...(guidanceSnapshot.docs.length > 0 ? guidanceSnapshot.docs.map((doc) => `- ${doc.displayPath}`) : ["- none"])
  ];

  if (guidanceSnapshot.warnings.length > 0) {
    lines.push("", renderSectionHeading("Warnings"), ...guidanceSnapshot.warnings.map((warning) => paintLine(`- ${warning}`, "warning")));
  }

  lines.push(
    "",
    renderSectionHeading("Next"),
    paintLine(
      `Run \`srgical studio operate --plan ${planId}\` (or \`sso --plan ${planId}\`) to execute with this config.`,
      "brand",
      { bold: true }
    )
  );

  process.stdout.write(`${lines.join("\n")}\n`);
}
