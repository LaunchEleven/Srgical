import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { getGlobalStudioSettingsPath, loadStudioSettings, saveStudioSettings } from "../../src/core/studio-settings";

test("studio-settings defaults to the primary theme when no global file exists", async () => {
  const home = await createTempHome();
  const settings = await loadStudioSettings(home);

  assert.equal(settings.themeId, "neon-command");
});

test("save-studio-settings persists the selected global theme and sanitizes unknown ids", async () => {
  const home = await createTempHome();

  const amber = await saveStudioSettings({ themeId: "amber-grid" }, home);
  assert.equal(amber.themeId, "amber-grid");

  const stored = await readFile(getGlobalStudioSettingsPath(home), "utf8");
  assert.match(stored, /"themeId":\s*"amber-grid"/);

  const sanitized = await saveStudioSettings({ themeId: "not-a-theme" }, home);
  assert.equal(sanitized.themeId, "neon-command");
});

async function createTempHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "srgical-studio-home-"));
  after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(home, { recursive: true, force: true });
  });
  return home;
}
