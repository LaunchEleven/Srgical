import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  MIN_WHEEL_SENSITIVITY,
  wheelSensitivityToScrollStep
} from "../../../apps/cli/src/core/studio-ui-config";
import { fileExists } from "../../../apps/cli/src/core/workspace";
import type { PlanningPackState } from "../../../apps/cli/src/core/planning-pack-state";
import type { StudioMode } from "@srgical/studio-shared";

const FILE_LIMIT = 6;
const SNIPPET_LIMIT = 1600;
const STUDIO_STREAM_CHAR_DELAY_MS = 4;
const GATHER_SOURCE_LIMIT_FALLBACK = 6000;

export async function selectAutoGatherFiles(workspaceRoot: string): Promise<string[]> {
  const preferred = ["package.json", "README.md", "docs/product-foundation.md"];
  const preferredExisting = (
    await Promise.all(
      preferred.map(async (relativePath) => ((await fileExists(path.join(workspaceRoot, relativePath))) ? relativePath : null))
    )
  ).filter((value): value is string => Boolean(value));
  const files = [
    ...preferredExisting,
    ...(await collect(path.join(workspaceRoot, "src"), workspaceRoot, FILE_LIMIT)),
    ...(await collect(path.join(workspaceRoot, "test"), workspaceRoot, FILE_LIMIT))
  ];
  return Array.from(new Set(files)).slice(0, FILE_LIMIT);
}

export function resolveStudioContextPath(workspaceRoot: string, rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^["']|["']$/g, "");
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(workspaceRoot, trimmed);
}

export function toStudioContextLabel(workspaceRoot: string, filePath: string): string {
  const relative = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") ? relative : path.resolve(filePath).replace(/\\/g, "/");
}

export function limitContextSource(value: string, maxChars: number | null = GATHER_SOURCE_LIMIT_FALLBACK): string {
  if (!maxChars || maxChars <= 0 || value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars).trimEnd()}\n... [truncated after ${maxChars} chars]`;
}

export function limitStudioSnippet(value: string): string {
  return value.length <= SNIPPET_LIMIT ? value : `${value.slice(0, SNIPPET_LIMIT).trimEnd()}\n... [truncated after ${SNIPPET_LIMIT} chars]`;
}

export function planStudioProgressiveReveal(current: string, finalized: string): { visible: string; pending: string } {
  if (!finalized) {
    return { visible: "", pending: "" };
  }
  if (current && finalized.startsWith(current)) {
    return {
      visible: current,
      pending: finalized.slice(current.length)
    };
  }
  return {
    visible: "",
    pending: finalized
  };
}

export function normalizeStudioStreamChunk(chunk: string): string {
  return chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function renderPlanningAdviceTranscript(advice: {
  problemStatement: string;
  clarity: string;
  stateAssessment: string;
  researchNeeded: string[];
  advice: string;
  nextAction: string;
}): string {
  return [
    "Gathered context review.",
    `Problem: ${advice.problemStatement}`,
    `Clarity: ${advice.clarity}`,
    "",
    "Assessment:",
    advice.stateAssessment,
    "",
    "Advice:",
    advice.advice,
    ...(advice.researchNeeded.length > 0 ? ["", "Research needed:", ...advice.researchNeeded.map((item) => `- ${item}`)] : []),
    "",
    `Next action: ${advice.nextAction}`
  ].join("\n");
}

export function renderGatherFollowUp(
  state: Pick<PlanningPackState, "readiness" | "nextAction">,
  advice: Pick<NonNullable<PlanningPackState["advice"]>, "researchNeeded" | "nextAction"> | null | undefined,
  options: { evidenceCount?: number } = {}
): string {
  const missing = new Set(state.readiness.missingLabels);
  const evidenceCount = options.evidenceCount ?? 0;
  const nextAction = advice?.nextAction || state.nextAction;
  const firstResearchNeed = advice?.researchNeeded.find((item) => item.trim().length > 0) ?? "";

  if (state.readiness.readyToWrite) {
    return ["Context is gathered and `context.md` is refreshed.", "Next: press `F3` to build the draft."].join("\n");
  }
  if (missing.has("Desired outcome captured")) {
    return ["I refreshed `context.md`, but I still need one thing from you.", "Need from you: say exactly what the first version should do."].join("\n");
  }
  if (missing.has("Repo context captured") && evidenceCount === 0) {
    return [
      "I did not find much repo truth automatically this pass.",
      "Next: use `:import <path>` for the file that matters most, or tell me what part of the repo this plan should target."
    ].join("\n");
  }
  if (missing.has("Constraints or decisions captured")) {
    return [
      "I refreshed `context.md`, but the plan still needs a few hard edges.",
      "Need from you: name any must-haves, must-not-haves, or fixed tool choices."
    ].join("\n");
  }
  if (missing.has("First safe slice captured")) {
    return [
      "I refreshed `context.md`, but the first execution slice is still fuzzy.",
      "Need from you: name the first safe step you want us to plan around."
    ].join("\n");
  }
  if (firstResearchNeed) {
    return ["I refreshed `context.md` and pulled together what I could.", `Still missing: ${firstResearchNeed}`, `Next: ${nextAction}`].join("\n");
  }
  return [
    evidenceCount > 0
      ? "I refreshed `context.md` with the latest gathered context."
      : "I refreshed `context.md`, but this pass did not surface much new evidence.",
    `Next: ${nextAction}`
  ].join("\n");
}

export function renderPrepareHelpText(): string {
  return [
    "Prepare commands:",
    "- Plain text without a prefix is normal planning chat.",
    "- Commands start with `:`. Example: `:help`, `:import notes.md`, `:build`, `:slice high spike`, `:operate`.",
    "- `:gather`: run another evidence pass and sync the gathered material into `context.md`.",
    "- `:import <path>`: read a specific document and sync it into `context.md` right away.",
    "- `:read <path>`: compatibility alias for `:import <path>`.",
    "- `:context`: refresh `context.md` from the current transcript and gathered evidence.",
    "- `:build`: write or refresh the current draft from transcript context and repo evidence.",
    "- `:slice`: slice the current draft using the recommended preset (`high + spike`).",
    "- `:slice [low|medium|high] [spike]`: override slice settings for this run.",
    "- `:slice --help`: show the slice arguments, defaults, and examples.",
    "- `:wheel [1-10]`: show or set transcript mouse-wheel sensitivity (saved in `.srgical/plans/<id>/studio-ui-config.json`).",
    "- `:theme [id]`: list or set the global Studio theme for the web UI.",
    "- `/dice ...`: legacy compatibility alias for slicing; `/dice --help` shows the same option guide with legacy defaults.",
    "- `/read <path>` and `/import <path>` still work as compatibility aliases during prepare.",
    "- `:help commands`: explain the `:` command syntax quickly.",
    "- `:review`: show the current changes log and manifest snapshot.",
    "- `:approve`: mark the current draft ready for operate.",
    "- `:operate`: switch to operate mode.",
    "- `:status`: show the current stage, next action, and next step.",
    "- `:quit`: exit studio."
  ].join("\n");
}

export function renderOperateHelpText(): string {
  return [
    "Operate commands:",
    "- Plain text chat is disabled here so execution stays action-first.",
    "- Commands start with `:`. Example: `:run`, `:auto 3`, `:checkpoint`, `:prepare`.",
    "- `:run`: execute the next queued step once.",
    "- `:auto [n]`: continue automatically for up to `n` steps, or the remaining queue when `n` is omitted.",
    "- `:checkpoint`: toggle PR checkpoint mode on or off.",
    "- `:wheel [1-10]`: show or set transcript mouse-wheel sensitivity for this plan.",
    "- `:theme [id]`: list or set the global Studio theme for the web UI.",
    "- `:review`: show the latest visible change summary and manifest snapshot.",
    "- `:unblock`: move the current blocked step back to `todo` with retry notes.",
    "- `:help commands`: explain the `:` command syntax quickly.",
    "- `:prepare`: switch back to prepare mode to refine the plan.",
    "- `:status`: show the current stage, next action, and next step.",
    "- `:stop`: request stop for an active auto-continue run.",
    "- `:quit`: exit studio."
  ].join("\n");
}

export function renderCommandSyntaxHelpText(mode: StudioMode): string {
  return [
    "Command syntax:",
    "- `:` is just the command prefix. There is no literal `:command` command.",
    mode === "prepare"
      ? "- In prepare, plain text is normal chat with the planner."
      : "- In operate, plain text chat is disabled so commands stay explicit.",
    "- Examples: `:help`, `:import notes.md`, `:context`, `:slice --help`, `:wheel 3`, `:theme neon-command`, `:build`, `:run`, `:auto 3`.",
    "- Old slash commands are retired. Use `:` commands instead. `/dice`, `/help`, `/read <path>`, and `/import <path>` still work as compatibility shortcuts."
  ].join("\n");
}

export function isDirectContextSyncRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /(update|refresh|sync|capture|move|transfer|fold|put|write).{0,60}(context\.md|context doc|context document|living doc)/.test(normalized) ||
    /(context\.md|context doc|context document|living doc).{0,60}(update|refresh|sync|capture|write)/.test(normalized)
  );
}

export function getScrollableWheelStep(wheelSensitivity = MIN_WHEEL_SENSITIVITY): number {
  return wheelSensitivityToScrollStep(wheelSensitivity);
}

export function delayStudioStream(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, STUDIO_STREAM_CHAR_DELAY_MS);
  });
}

async function collect(dir: string, root: string, limit: number): Promise<string[]> {
  try {
    const out: string[] = [];
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= limit) {
        break;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await collect(full, root, limit - out.length)));
        continue;
      }
      out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
    return out;
  } catch {
    return [];
  }
}
