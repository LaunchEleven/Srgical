import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { getInitialTemplates } from "../../src/core/templates";
import { ensurePlanningDir, getPlanningPackPaths, saveActivePlanId, writeText } from "../../src/core/workspace";

export async function createTempWorkspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

export async function writePlanningPack(
  root: string,
  options: {
    planId?: string | null;
    activate?: boolean;
  } = {}
): Promise<ReturnType<typeof getPlanningPackPaths>> {
  const paths = await ensurePlanningDir(root, { planId: options.planId });
  const templates = getInitialTemplates(paths);

  await Promise.all(Object.entries(templates).map(([filePath, content]) => writeText(filePath, content)));
  if (options.activate) {
    await saveActivePlanId(root, paths.planId);
  }

  return paths;
}
