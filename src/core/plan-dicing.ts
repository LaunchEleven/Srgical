export type PlanDiceResolution = "low" | "medium" | "high";

export type PlanDiceOptions = {
  resolution: PlanDiceResolution;
  allowLiveFireSpike: boolean;
};

const RESOLUTION_VALUES = new Set<PlanDiceResolution>(["low", "medium", "high"]);
const SPIKE_TOKENS = new Set(["spike", "live-fire", "livefire", "live", "fire"]);

export function parsePlanDiceCommand(command: string): PlanDiceOptions | null {
  const trimmed = command.trim();

  if (trimmed === "/dice") {
    return {
      resolution: "medium",
      allowLiveFireSpike: false
    };
  }

  if (!trimmed.startsWith("/dice ")) {
    return null;
  }

  const tokens = trimmed
    .slice("/dice".length)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());

  if (tokens.length === 0) {
    return {
      resolution: "medium",
      allowLiveFireSpike: false
    };
  }

  let resolution: PlanDiceResolution = "medium";
  let allowLiveFireSpike = false;

  for (const token of tokens) {
    if (RESOLUTION_VALUES.has(token as PlanDiceResolution)) {
      resolution = token as PlanDiceResolution;
      continue;
    }

    if (SPIKE_TOKENS.has(token)) {
      allowLiveFireSpike = true;
      continue;
    }

    return null;
  }

  return {
    resolution,
    allowLiveFireSpike
  };
}

export function renderPlanDiceLabel(options: PlanDiceOptions): string {
  return options.allowLiveFireSpike ? `${options.resolution} + spike` : options.resolution;
}
