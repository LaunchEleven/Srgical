import process from "node:process";

type ThemeTone = "brand" | "section" | "info" | "success" | "warning" | "danger" | "muted";

const ANSI_PREFIX = "\u001b[";
const ANSI_RESET = "\u001b[0m";

const TONE_CODES: Record<ThemeTone, string> = {
  brand: "38;5;45",
  section: "38;5;117",
  info: "38;5;153",
  success: "38;5;84",
  warning: "38;5;214",
  danger: "38;5;203",
  muted: "38;5;245"
};

function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  if (process.env.FORCE_COLOR === "0") {
    return false;
  }

  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") {
    return true;
  }

  if (process.stdout.isTTY !== true) {
    return false;
  }

  const term = (process.env.TERM ?? "").toLowerCase();
  return term !== "dumb";
}

export function paintLine(
  line: string,
  tone: ThemeTone,
  options: {
    bold?: boolean;
    dim?: boolean;
  } = {}
): string {
  if (!line || !shouldUseColor()) {
    return line;
  }

  const codes: string[] = [TONE_CODES[tone]];
  if (options.bold) {
    codes.push("1");
  }
  if (options.dim) {
    codes.push("2");
  }

  return `${ANSI_PREFIX}${codes.join(";")}m${line}${ANSI_RESET}`;
}

export function renderCommandBanner(command: string, subtitle?: string): string[] {
  const normalizedCommand = command.trim().toUpperCase();
  const normalizedSubtitle = subtitle?.trim();
  const heading = normalizedSubtitle ? `${normalizedCommand} :: ${normalizedSubtitle}` : normalizedCommand;
  const width = Math.max(68, heading.length + 8);
  const rail = "=".repeat(width);

  return [paintLine(rail, "brand"), paintLine(`  ${heading}`, "brand", { bold: true }), paintLine(rail, "brand")];
}

export function renderSectionHeading(title: string): string {
  return paintLine(`[ ${title.trim().toUpperCase()} ]`, "section", { bold: true });
}

export function renderMutedHint(line: string): string {
  return paintLine(line, "muted");
}

export function toneForAvailabilityLine(line: string): ThemeTone {
  if (line.includes("missing") || line.includes("failed")) {
    return "danger";
  }
  if (line.includes("pending") || line.includes("none cached")) {
    return "warning";
  }
  if (line.includes("available") || line.includes("ready") || line.includes("completed")) {
    return "success";
  }
  return "info";
}
