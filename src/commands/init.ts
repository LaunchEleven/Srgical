import process from "node:process";
import { getInitialTemplates } from "../core/templates";
import { ensurePlanningDir, planningPackExists, resolveWorkspace, writeText } from "../core/workspace";

export async function runInitCommand(workspaceArg?: string, force = false): Promise<void> {
  const workspace = resolveWorkspace(workspaceArg);
  const exists = await planningPackExists(workspace);

  if (exists && !force) {
    throw new Error("A .srgical planning pack already exists. Re-run with --force to overwrite it.");
  }

  const paths = await ensurePlanningDir(workspace);
  const templates = getInitialTemplates(paths);

  await Promise.all(
    Object.entries(templates).map(([filePath, content]) => writeText(filePath, content))
  );

  process.stdout.write(
    [
      `Created planning pack in ${paths.dir}`,
      `- ${paths.plan}`,
      `- ${paths.context}`,
      `- ${paths.tracker}`,
      `- ${paths.nextPrompt}`
    ].join("\n") + "\n"
  );
}
