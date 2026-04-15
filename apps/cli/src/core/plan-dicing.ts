export type PlanDiceResolution = "low" | "medium" | "high";

export type PlanDiceOptions = {
  resolution: PlanDiceResolution;
  allowLiveFireSpike: boolean;
};

export type PlanDiceCommandName = "/dice" | ":slice";

export type PlanDiceIntent = {
  command: PlanDiceCommandName;
  options: PlanDiceOptions;
  helpRequested: boolean;
};

const RESOLUTION_VALUES = new Set<PlanDiceResolution>(["low", "medium", "high"]);
const SPIKE_TOKENS = new Set(["spike", "live-fire", "livefire", "live", "fire"]);
const HELP_TOKENS = new Set(["--help", "-h", "help"]);

export const DEFAULT_PLAN_DICE_OPTIONS: PlanDiceOptions = {
  resolution: "medium",
  allowLiveFireSpike: false
};

export const DEFAULT_SLICE_PLAN_OPTIONS: PlanDiceOptions = {
  resolution: "high",
  allowLiveFireSpike: true
};

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

export function parsePlanDiceIntent(command: string): PlanDiceIntent | null {
  return parsePrefixedDiceIntent(command, "/dice") ?? parsePrefixedDiceIntent(command, ":slice");
}

export function renderPlanDiceHelp(command: PlanDiceCommandName = "/dice"): string {
  const usage = command === ":slice" ? ":slice [low|medium|high] [spike]" : "/dice [low|medium|high] [spike]";
  const defaultLabel =
    command === ":slice"
      ? `${renderPlanDiceLabel(DEFAULT_SLICE_PLAN_OPTIONS)} (recommended preset when no args are provided)`
      : `${renderPlanDiceLabel(DEFAULT_PLAN_DICE_OPTIONS)} (legacy compatibility default when no args are provided)`;
  const compatibilityNote =
    command === "/dice"
      ? "Compatibility note: `/dice` is still supported inside prepare, but `:slice` and `F4 Slice Plan` are the preferred rebooted actions."
      : "Compatibility note: `/dice` is still accepted as a legacy alias if old muscle memory kicks in.";

  return [
    `Usage: \`${usage}\``,
    "",
    "What it does:",
    "- Rewrites the current draft into clearer, execution-ready tracker steps.",
    "- Keeps the plan incremental and can insert a spike step before risky implementation work.",
    "",
    "Defaults:",
    `- No args: ${defaultLabel}.`,
    "",
    "Arguments:",
    "- `low`: coarse slicing with fewer, larger step blocks.",
    "- `medium`: balanced slicing with practical PR-sized steps.",
    "- `high`: very fine-grained slicing with the smallest practical execution steps.",
    "- `spike`: allows an explicit `SPIKE-###` proof step when the first risky seam needs validation before downstream build work.",
    "",
    "Accepted spike aliases:",
    "- `spike`, `live-fire`, `livefire`, `live`, `fire`",
    "",
    "Examples:",
    `- \`${command}\``,
    `- \`${command === ":slice" ? ":slice medium" : "/dice medium"}\``,
    `- \`${command === ":slice" ? ":slice high spike" : "/dice high spike"}\``,
    `- \`${command === ":slice" ? ":slice low --help" : "/dice low --help"}\``,
    "",
    compatibilityNote
  ].join("\n");
}

function parsePrefixedDiceIntent(command: string, prefix: PlanDiceCommandName): PlanDiceIntent | null {
  const trimmed = command.trim();
  const noArgDefault = prefix === ":slice" ? DEFAULT_SLICE_PLAN_OPTIONS : DEFAULT_PLAN_DICE_OPTIONS;

  if (trimmed === prefix) {
    return {
      command: prefix,
      options: clonePlanDiceOptions(noArgDefault),
      helpRequested: false
    };
  }

  if (!trimmed.startsWith(`${prefix} `)) {
    return null;
  }

  const tokens = trimmed
    .slice(prefix.length)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());

  const helpRequested = tokens.some((token) => HELP_TOKENS.has(token));
  const substantiveTokens = tokens.filter((token) => !HELP_TOKENS.has(token));

  if (substantiveTokens.length === 0) {
    return {
      command: prefix,
      options: clonePlanDiceOptions(noArgDefault),
      helpRequested
    };
  }

  let resolution: PlanDiceResolution = "medium";
  let allowLiveFireSpike = false;

  for (const token of substantiveTokens) {
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
    command: prefix,
    options: {
      resolution,
      allowLiveFireSpike
    },
    helpRequested
  };
}

function clonePlanDiceOptions(options: PlanDiceOptions): PlanDiceOptions {
  return {
    resolution: options.resolution,
    allowLiveFireSpike: options.allowLiveFireSpike
  };
}
