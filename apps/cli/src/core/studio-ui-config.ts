import { ensurePlanningDir, fileExists, getPlanningPackPaths, readText, writeText, type PlanningPathOptions } from "./workspace";

type StoredStudioUiConfig = {
  version: 1;
  updatedAt: string;
  wheelSensitivity: number;
};

export type StudioUiConfig = {
  wheelSensitivity: number;
  updatedAt: string;
};

export const MIN_WHEEL_SENSITIVITY = 1;
export const MAX_WHEEL_SENSITIVITY = 10;

const DEFAULT_CONFIG: StudioUiConfig = {
  wheelSensitivity: 2,
  updatedAt: "1970-01-01T00:00:00.000Z"
};

export async function loadStudioUiConfig(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<StudioUiConfig> {
  const paths = getPlanningPackPaths(workspaceRoot, options);

  if (!(await fileExists(paths.studioUiConfig))) {
    return cloneConfig(DEFAULT_CONFIG);
  }

  try {
    const raw = await readText(paths.studioUiConfig);
    const parsed = JSON.parse(raw) as Partial<StoredStudioUiConfig>;
    return {
      wheelSensitivity: sanitizeWheelSensitivity(parsed.wheelSensitivity),
      updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0 ? parsed.updatedAt : DEFAULT_CONFIG.updatedAt
    };
  } catch {
    return cloneConfig(DEFAULT_CONFIG);
  }
}

export async function ensureStudioUiConfig(
  workspaceRoot: string,
  options: PlanningPathOptions = {}
): Promise<StudioUiConfig> {
  const paths = await ensurePlanningDir(workspaceRoot, options);

  if (await fileExists(paths.studioUiConfig)) {
    return loadStudioUiConfig(workspaceRoot, options);
  }

  const next: StoredStudioUiConfig = {
    version: 1,
    updatedAt: new Date().toISOString(),
    wheelSensitivity: DEFAULT_CONFIG.wheelSensitivity
  };
  await writeText(paths.studioUiConfig, JSON.stringify(next, null, 2));

  return {
    wheelSensitivity: next.wheelSensitivity,
    updatedAt: next.updatedAt
  };
}

export async function saveStudioUiConfig(
  workspaceRoot: string,
  updates: {
    wheelSensitivity?: number;
  },
  options: PlanningPathOptions = {}
): Promise<StudioUiConfig> {
  const current = await loadStudioUiConfig(workspaceRoot, options);
  const next: StoredStudioUiConfig = {
    version: 1,
    updatedAt: new Date().toISOString(),
    wheelSensitivity: sanitizeWheelSensitivity(updates.wheelSensitivity ?? current.wheelSensitivity)
  };
  const paths = await ensurePlanningDir(workspaceRoot, options);
  await writeText(paths.studioUiConfig, JSON.stringify(next, null, 2));

  return {
    wheelSensitivity: next.wheelSensitivity,
    updatedAt: next.updatedAt
  };
}

export function sanitizeWheelSensitivity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CONFIG.wheelSensitivity;
  }

  const rounded = Math.round(value);
  return Math.max(MIN_WHEEL_SENSITIVITY, Math.min(MAX_WHEEL_SENSITIVITY, rounded));
}

export function wheelSensitivityToScrollStep(wheelSensitivity: number): number {
  const normalized = sanitizeWheelSensitivity(wheelSensitivity);
  return Math.max(1, Math.ceil(normalized / 2));
}

function cloneConfig(config: StudioUiConfig): StudioUiConfig {
  return {
    wheelSensitivity: config.wheelSensitivity,
    updatedAt: config.updatedAt
  };
}
