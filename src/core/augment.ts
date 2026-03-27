import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writePlanningPackFallback } from "./local-pack";
import {
  formatPlanningEpochSummary,
  preparePlanningPackForWrite,
  type PlanningEpochPreparation
} from "./planning-epochs";
import { buildPackWriterPrompt, buildPlannerPrompt, type ChatMessage } from "./prompts";

export type AugmentStatus = {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
};

type AugmentExecOptions = {
  cwd: string;
  prompt: string;
  askMode?: boolean;
  maxTurns?: number;
};

type AugmentExecResult = {
  stdout: string;
  stderr: string;
  lastMessage: string;
};

type SpawnCaptureResult = {
  stdout: string;
  stderr: string;
};

type SpawnCaptureFn = (
  command: string,
  args: string[],
  cwd: string,
  stdinText?: string
) => Promise<SpawnCaptureResult>;

const AUGMENT_INSTALL_HINT = "install Augment CLI to enable";
const AUGMENT_DEFAULT_RULES = `You are operating inside srgical, a local-first planning and iteration machine.

Default behavior:
- Ground decisions in the current repository state and the current .srgical files when they exist.
- Prefer small validated steps over broad speculative rewrites.
- Preserve a clear next-step handoff after each meaningful change.
- Treat planning as preparation for execution, not open-ended brainstorming.
- Keep outputs practical, explicit, and ready for the next iteration.`;

let augmentCommandPromise: Promise<string> | undefined;
let forcedAugmentCommand: string | null = null;
let spawnAndCaptureImpl: SpawnCaptureFn = spawnAndCaptureBase;

export async function detectAugment(): Promise<AugmentStatus> {
  try {
    const command = await resolveAugmentCommand();
    const version = await spawnAndCaptureImpl(command, ["--version"], process.cwd());
    return {
      available: true,
      command,
      version: version.stdout.trim()
    };
  } catch (error) {
    return {
      available: false,
      command: process.platform === "win32" ? "auggie.exe" : "auggie",
      error: normalizeAugmentDetectionError(error)
    };
  }
}

export async function requestPlannerReply(workspaceRoot: string, messages: ChatMessage[]): Promise<string> {
  const result = await runAugmentExec({
    cwd: workspaceRoot,
    prompt: buildPlannerPrompt(messages, workspaceRoot),
    askMode: true,
    maxTurns: 4
  });

  return result.lastMessage.trim();
}

export async function writePlanningPack(workspaceRoot: string, messages: ChatMessage[]): Promise<string> {
  const planningEpoch = await preparePlanningPackForWrite(workspaceRoot);
  const augmentStatus = await detectAugment();

  if (!augmentStatus.available) {
    return appendPlanningEpochSummary(
      planningEpoch,
      await writePlanningPackFallback(
        workspaceRoot,
        messages,
        augmentStatus.error ?? "Augment CLI is unavailable",
        "Augment CLI"
      )
    );
  }

  try {
    const result = await runAugmentExec({
      cwd: workspaceRoot,
      prompt: await buildPackWriterPrompt(messages, workspaceRoot),
      maxTurns: 24
    });

    return appendPlanningEpochSummary(planningEpoch, result.lastMessage.trim());
  } catch (error) {
    if (isAugmentUnavailableError(error)) {
      const message = error instanceof Error ? error.message : "Augment CLI is unavailable";
      return appendPlanningEpochSummary(
        planningEpoch,
        await writePlanningPackFallback(workspaceRoot, messages, message, "Augment CLI")
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    const epochSummary = formatPlanningEpochSummary(planningEpoch);

    if (epochSummary) {
      throw new Error(`${epochSummary}\n${message}`);
    }

    throw error;
  }
}

export async function runNextPrompt(workspaceRoot: string, prompt: string): Promise<string> {
  const result = await runAugmentExec({
    cwd: workspaceRoot,
    prompt,
    maxTurns: 24
  });

  return result.lastMessage.trim();
}

export function setAugmentRuntimeForTesting(options: {
  command?: string | null;
  spawnAndCapture?: SpawnCaptureFn;
}): void {
  if (Object.prototype.hasOwnProperty.call(options, "command")) {
    forcedAugmentCommand = options.command ?? null;
    augmentCommandPromise = undefined;
  }

  if (options.spawnAndCapture) {
    spawnAndCaptureImpl = options.spawnAndCapture;
  }
}

export function resetAugmentRuntimeForTesting(): void {
  forcedAugmentCommand = null;
  augmentCommandPromise = undefined;
  spawnAndCaptureImpl = spawnAndCaptureBase;
}

async function runAugmentExec(options: AugmentExecOptions): Promise<AugmentExecResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "srgical-augment-"));
  const promptFile = path.join(tempDir, "prompt.txt");
  const rulesFile = path.join(tempDir, "rules.md");
  const command = await resolveAugmentCommand();
  const args = [
    "--print",
    "--quiet",
    "--workspace-root",
    options.cwd,
    "--instruction-file",
    promptFile,
    "--rules",
    rulesFile,
    "--allow-indexing",
    "--wait-for-indexing"
  ];

  if (options.askMode) {
    args.push("--ask");
  }

  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }

  await writeFile(promptFile, options.prompt, "utf8");
  await writeFile(rulesFile, AUGMENT_DEFAULT_RULES, "utf8");

  try {
    const result = await spawnAndCaptureImpl(command, args, options.cwd);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      lastMessage: result.stdout.trim()
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function resolveAugmentCommand(): Promise<string> {
  if (forcedAugmentCommand) {
    return forcedAugmentCommand;
  }

  if (!augmentCommandPromise) {
    augmentCommandPromise = loadAugmentCommand();
  }

  return augmentCommandPromise;
}

async function loadAugmentCommand(): Promise<string> {
  if (process.platform !== "win32") {
    return "auggie";
  }

  const result = await spawnAndCaptureImpl("where.exe", ["auggie"], process.cwd());
  const matches = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const shim = matches.find((line) => {
    const lower = line.toLowerCase();
    return lower.endsWith(".cmd") || lower.endsWith(".bat");
  });
  if (shim) {
    return shim;
  }

  const executable = matches.find((line) => line.toLowerCase().endsWith(".exe"));
  if (executable) {
    return executable;
  }

  for (const candidate of matches) {
    const siblingShim = await resolveSiblingShim(candidate);
    if (siblingShim) {
      return siblingShim;
    }
  }

  if (matches.length > 0) {
    return matches[0];
  }

  throw new Error("Unable to resolve an Augment executable path.");
}

function spawnAndCaptureBase(
  command: string,
  args: string[],
  cwd: string,
  stdinText?: string
): Promise<SpawnCaptureResult> {
  return new Promise((resolve, reject) => {
    const spec = buildSpawnSpec(command, args, cwd);
    const child = spawn(spec.command, spec.args, spec.options);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`));
    });

    if (stdinText) {
      child.stdin.write(stdinText);
    }

    child.stdin.end();
  });
}

function buildSpawnSpec(command: string, args: string[], cwd: string): {
  command: string;
  args: string[];
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell?: boolean;
  };
} {
  const lower = command.toLowerCase();

  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    const commandLine = [quoteForShell(command), ...args.map(quoteForShell)].join(" ");
    return {
      command: commandLine,
      args: [],
      options: {
        cwd,
        env: process.env,
        shell: true
      }
    };
  }

  return {
    command,
    args,
    options: {
      cwd,
      env: process.env
    }
  };
}

async function resolveSiblingShim(candidate: string): Promise<string | null> {
  const extension = path.extname(candidate);

  if (extension) {
    return null;
  }

  for (const suffix of [".cmd", ".bat", ".exe"]) {
    const sibling = `${candidate}${suffix}`;

    try {
      await access(sibling);
      return sibling;
    } catch {
      continue;
    }
  }

  return null;
}

function quoteForShell(value: string): string {
  if (/^[A-Za-z0-9_:\\/.=-]+$/.test(value)) {
    return value;
  }

  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function normalizeAugmentDetectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Failed to run auggie";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find files for the given pattern") ||
    normalized.includes("unable to resolve an augment executable path") ||
    normalized.includes("'auggie' is not recognized") ||
    normalized.includes("enoent")
  ) {
    return AUGMENT_INSTALL_HINT;
  }

  return message;
}

function isAugmentUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("unable to resolve an augment executable path") ||
    message.includes("'auggie' is not recognized") ||
    message.includes("enoent") ||
    message.includes("failed to run auggie")
  );
}

function appendPlanningEpochSummary(preparation: PlanningEpochPreparation, summary: string): string {
  const epochSummary = formatPlanningEpochSummary(preparation);
  return [epochSummary, summary].filter(Boolean).join("\n");
}
