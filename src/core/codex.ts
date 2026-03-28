import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writePlanningPackFallback } from "./local-pack";
import {
  formatPlanningEpochSummary,
  preparePlanningPackForWrite,
  type PlanningEpochPreparation
} from "./planning-epochs";
import { buildPackWriterPrompt, buildPlannerPrompt, type ChatMessage } from "./prompts";
import type { PlanningPathOptions } from "./workspace";

export type CodexStatus = {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
};

export type CodexExecOptions = {
  cwd: string;
  prompt: string;
  allowWrite?: boolean;
  skipGitRepoCheck?: boolean;
  ephemeral?: boolean;
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

let codexCommandPromise: Promise<string> | undefined;
let forcedCodexCommand: string | null = null;
let spawnAndCaptureImpl: SpawnCaptureFn = spawnAndCaptureBase;

export async function detectCodex(): Promise<CodexStatus> {
  try {
    const command = await resolveCodexCommand();
    const version = await spawnAndCaptureImpl(command, ["--version"], process.cwd());
    return {
      available: true,
      command,
      version: version.stdout.trim()
    };
  } catch (error) {
    return {
      available: false,
      command: process.platform === "win32" ? "codex.exe" : "codex",
      error: error instanceof Error ? error.message : "Failed to run codex"
    };
  }
}

export async function requestPlannerReply(
  workspaceRoot: string,
  messages: ChatMessage[],
  _options: PlanningPathOptions = {}
): Promise<string> {
  const result = await runCodexExec({
    cwd: workspaceRoot,
    prompt: buildPlannerPrompt(messages, workspaceRoot),
    allowWrite: false,
    skipGitRepoCheck: true,
    ephemeral: true
  });

  return result.lastMessage.trim();
}

export async function writePlanningPack(
  workspaceRoot: string,
  messages: ChatMessage[],
  options: PlanningPathOptions = {}
): Promise<string> {
  const planningEpoch = await preparePlanningPackForWrite(workspaceRoot, options);
  const codexStatus = await detectCodex();

  if (!codexStatus.available) {
    return appendPlanningEpochSummary(
      planningEpoch,
      await writePlanningPackFallback(workspaceRoot, messages, codexStatus.error ?? "Codex is unavailable", "Codex", options)
    );
  }

  try {
    const result = await runCodexExec({
      cwd: workspaceRoot,
      prompt: await buildPackWriterPrompt(messages, workspaceRoot, options),
      allowWrite: true,
      skipGitRepoCheck: true,
      ephemeral: false
    });

    return appendPlanningEpochSummary(planningEpoch, result.lastMessage.trim());
  } catch (error) {
    if (isCodexUnavailableError(error)) {
      const message = error instanceof Error ? error.message : "Codex is unavailable";
      return appendPlanningEpochSummary(
        planningEpoch,
        await writePlanningPackFallback(workspaceRoot, messages, message, "Codex", options)
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

export async function runNextPrompt(
  workspaceRoot: string,
  prompt: string,
  _options: PlanningPathOptions = {}
): Promise<string> {
  const result = await runCodexExec({
    cwd: workspaceRoot,
    prompt,
    allowWrite: true,
    skipGitRepoCheck: true,
    ephemeral: false
  });

  return result.lastMessage.trim();
}

type CodexExecResult = {
  stdout: string;
  stderr: string;
  lastMessage: string;
};

export function setCodexRuntimeForTesting(options: {
  command?: string | null;
  spawnAndCapture?: SpawnCaptureFn;
}): void {
  if (Object.prototype.hasOwnProperty.call(options, "command")) {
    forcedCodexCommand = options.command ?? null;
    codexCommandPromise = undefined;
  }

  if (options.spawnAndCapture) {
    spawnAndCaptureImpl = options.spawnAndCapture;
  }
}

export function resetCodexRuntimeForTesting(): void {
  forcedCodexCommand = null;
  codexCommandPromise = undefined;
  spawnAndCaptureImpl = spawnAndCaptureBase;
}

async function runCodexExec(options: CodexExecOptions): Promise<CodexExecResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "srgical-codex-"));
  const outputFile = path.join(tempDir, "last-message.txt");
  const args = ["exec", "--color", "never", "-o", outputFile];
  const command = await resolveCodexCommand();

  if (options.allowWrite) {
    args.push("--full-auto");
  } else {
    args.push("-s", "read-only");
  }

  if (options.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }

  if (options.ephemeral) {
    args.push("--ephemeral");
  }

  args.push("-");

  try {
    const result = await spawnAndCaptureImpl(command, args, options.cwd, options.prompt);
    const lastMessage = await readFile(outputFile, "utf8");

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      lastMessage
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function resolveCodexCommand(): Promise<string> {
  if (forcedCodexCommand) {
    return forcedCodexCommand;
  }

  if (!codexCommandPromise) {
    codexCommandPromise = loadCodexCommand();
  }

  return codexCommandPromise;
}

async function loadCodexCommand(): Promise<string> {
  if (process.platform !== "win32") {
    return "codex";
  }

  const result = await spawnAndCaptureImpl("where.exe", ["codex"], process.cwd());
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

  throw new Error("Unable to resolve a Codex executable path.");
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

function isCodexUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("unable to resolve a codex executable path") ||
    message.includes("'codex' is not recognized") ||
    message.includes("enoent") ||
    message.includes("failed to run codex")
  );
}

function appendPlanningEpochSummary(preparation: PlanningEpochPreparation, summary: string): string {
  const epochSummary = formatPlanningEpochSummary(preparation);
  return [epochSummary, summary].filter(Boolean).join("\n");
}
