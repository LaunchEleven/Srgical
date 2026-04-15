import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StudioSettings } from "@srgical/studio-shared";

type StoredStudioSettings = {
  version: 1;
  updatedAt: string;
  themeId: string;
};

export function getGlobalStudioSettingsPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".srgical", "studio-settings.json");
}

export async function loadStudioSettings(homeDir?: string): Promise<StudioSettings> {
  const settingsPath = getGlobalStudioSettingsPath(homeDir);

  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredStudioSettings>;
    const themeId = sanitizeThemeId(parsed.themeId);

    return {
      themeId,
      updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0
        ? parsed.updatedAt
        : createDefaultSettings().updatedAt
    };
  } catch {
    return createDefaultSettings();
  }
}

export async function saveStudioSettings(
  updates: Partial<Pick<StudioSettings, "themeId">>,
  homeDir?: string
): Promise<StudioSettings> {
  const current = await loadStudioSettings(homeDir);
  const next: StoredStudioSettings = {
    version: 1,
    updatedAt: new Date().toISOString(),
    themeId: sanitizeThemeId(updates.themeId ?? current.themeId)
  };
  const settingsPath = getGlobalStudioSettingsPath(homeDir);

  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(next, null, 2), "utf8");

  return {
    themeId: next.themeId,
    updatedAt: next.updatedAt
  };
}

function createDefaultSettings(): StudioSettings {
  return {
    themeId: "neon-command",
    updatedAt: "1970-01-01T00:00:00.000Z"
  };
}

function sanitizeThemeId(value: unknown): string {
  return value === "amber-grid" ? "amber-grid" : "neon-command";
}
