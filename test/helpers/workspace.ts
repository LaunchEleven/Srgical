import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { getInitialTemplates } from "../../src/core/templates";
import { ensurePlanningDir, getPlanningPackPaths, writeText } from "../../src/core/workspace";

export async function createTempWorkspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

export async function writePlanningPack(root: string): Promise<ReturnType<typeof getPlanningPackPaths>> {
  const paths = await ensurePlanningDir(root);
  const templates = getInitialTemplates(paths);

  await Promise.all(Object.entries(templates).map(([filePath, content]) => writeText(filePath, content)));

  return paths;
}
