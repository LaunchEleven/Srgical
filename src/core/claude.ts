import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentInvocationOptions } from "./agent";
import type { PlanDiceOptions } from "./plan-dicing";
import { writePlanningPackFallback } from "./local-pack";
import {
  formatPlanningEpochSummary,
  preparePlanningPackForWrite,
  type PlanningEpochPreparation
} from "./planning-epochs";
import { buildAdvicePrompt, buildPackWriterPrompt, buildPlanDicePrompt, buildPlannerPrompt, type ChatMessage } from "./prompts";
import { readPlanningPackState, type PlanningPackState } from "./planning-pack-state";

export type ClaudeStatus = {
  available: boolean;
  command: string;
  version?: string;
  error?: string;
};

export type ClaudePermissionMode = "plan" | "acceptEdits";

type ClaudeExecOptions = {
  cwd: string;
  prompt: string;
  permissionMode: ClaudePermissionMode;
  allowedTools?: string[];
  maxTurns?: number;
  onOutputChunk?: (chunk: string) => void;
};

type ClaudeExecResult = {
  stdout: string;
  stderr: string;
  lastMessage: string;
};

type SpawnCaptureResult = {
  stdout: string;
  stderr: string;
};

type SpawnCaptureOptions = {
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
};

type SpawnCaptureFn = (
  command: string,
  args: string[],
  cwd: string,
  stdinText?: string,
  options?: SpawnCaptureOptions
) => Promise<SpawnCaptureResult>;

const FOLLOW_APPENDED_PROMPT_QUERY =
  "Follow the appended system prompt exactly, do the work in the current working directory, and return only the final response.";
const CLAUDE_WRITE_ALLOW_TOOLS = ["Bash", "Read", "Edit", "Write"];
const CLAUDE_INSTALL_HINT = "install Claude Code CLI to enable";

let claudeCommandPromise: Promise<string> | undefined;
let forcedClaudeCommand: string | null = null;
let spawnAndCaptureImpl: SpawnCaptureFn = spawnAndCaptureBase;

export async function detectClaude(): Promise<ClaudeStatus> {
  try {
    const command = await resolveClaudeCommand();
    const version = await spawnAndCaptureImpl(command, ["--version"], process.cwd());
    return {
      available: true,
      command,
      version: version.stdout.trim()
    };
  } catch (error) {
    return {
      available: false,
      command: process.platform === "win32" ? "claude.exe" : "claude",
      error: normalizeClaudeDetectionError(error)
    };
  }
}

export async function requestPlannerReply(
  workspaceRoot: string,
  messages: ChatMessage[],
  options: AgentInvocationOptions = {}
): Promise<string> {
  const packState = await readPlanningPackState(workspaceRoot, options);
  const result = await runClaudeExec({
    cwd: workspaceRoot,
    prompt: buildPlannerPrompt(messages, workspaceRoot, packState),
    permissionMode: "plan",
    maxTurns: 4,
    onOutputChunk: options.onOutputChunk
  });

  return result.lastMessage.trim();
}

export async function requestPlanningAdvice(
  workspaceRoot: string,
  messages: ChatMessage[],
  packState: PlanningPackState,
  options: AgentInvocationOptions = {}
): Promise<string> {
  const result = await runClaudeExec({
    cwd: workspaceRoot,
    prompt: await buildAdvicePrompt(messages, workspaceRoot, packState, options),
    permissionMode: "plan",
    maxTurns: 4,
    onOutputChunk: options.onOutputChunk
  });

  return result.lastMessage.trim();
}

export async function writePlanningPack(
  workspaceRoot: string,
  messages: ChatMessage[],
  options: AgentInvocationOptions = {}
): Promise<string> {
  const planningEpoch = await preparePlanningPackForWrite(workspaceRoot, options);
  const claudeStatus = await detectClaude();

  if (!claudeStatus.available) {
    return appendPlanningEpochSummary(
      planningEpoch,
      await writePlanningPackFallback(
        workspaceRoot,
        messages,
        claudeStatus.error ?? "Claude Code CLI is unavailable",
        "Claude Code",
        options
      )
    );
  }

  try {
    const result = await runClaudeExec({
      cwd: workspaceRoot,
      prompt: await buildPackWriterPrompt(messages, workspaceRoot, options),
      permissionMode: "acceptEdits",
      allowedTools: CLAUDE_WRITE_ALLOW_TOOLS,
      maxTurns: 24,
      onOutputChunk: options.onOutputChunk
    });

    return appendPlanningEpochSummary(planningEpoch, result.lastMessage.trim());
  } catch (error) {
    if (isClaudeUnavailableError(error)) {
      const message = error instanceof Error ? error.message : "Claude Code CLI is unavailable";
      return appendPlanningEpochSummary(
        planningEpoch,
        await writePlanningPackFallback(workspaceRoot, messages, message, "Claude Code", options)
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

export async function dicePlanningPack(
  workspaceRoot: string,
  messages: ChatMessage[],
  diceOptions: PlanDiceOptions,
  options: AgentInvocationOptions = {}
): Promise<string> {
  const planningEpoch = await preparePlanningPackForWrite(workspaceRoot, options);
  const claudeStatus = await detectClaude();

  if (!claudeStatus.available) {
    return appendPlanningEpochSummary(
      planningEpoch,
      await writePlanningPackFallback(
        workspaceRoot,
        messages,
        claudeStatus.error ?? "Claude Code CLI is unavailable",
        "Claude Code",
        options
      )
    );
  }

  try {
    const result = await runClaudeExec({
      cwd: workspaceRoot,
      prompt: await buildPlanDicePrompt(messages, workspaceRoot, diceOptions, options),
      permissionMode: "acceptEdits",
      allowedTools: CLAUDE_WRITE_ALLOW_TOOLS,
      maxTurns: 24,
      onOutputChunk: options.onOutputChunk
    });

    return appendPlanningEpochSummary(planningEpoch, result.lastMessage.trim());
  } catch (error) {
    if (isClaudeUnavailableError(error)) {
      const message = error instanceof Error ? error.message : "Claude Code CLI is unavailable";
      return appendPlanningEpochSummary(
        planningEpoch,
        await writePlanningPackFallback(workspaceRoot, messages, message, "Claude Code", options)
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
  options: AgentInvocationOptions = {}
): Promise<string> {
  const result = await runClaudeExec({
    cwd: workspaceRoot,
    prompt,
    permissionMode: "acceptEdits",
    allowedTools: CLAUDE_WRITE_ALLOW_TOOLS,
    maxTurns: 24,
    onOutputChunk: options.onOutputChunk
  });

  return result.lastMessage.trim();
}

export function setClaudeRuntimeForTesting(options: {
  command?: string | null;
  spawnAndCapture?: SpawnCaptureFn;
}): void {
  if (Object.prototype.hasOwnProperty.call(options, "command")) {
    forcedClaudeCommand = options.command ?? null;
    claudeCommandPromise = undefined;
  }

  if (options.spawnAndCapture) {
    spawnAndCaptureImpl = options.spawnAndCapture;
  }
}

export function resetClaudeRuntimeForTesting(): void {
  forcedClaudeCommand = null;
  claudeCommandPromise = undefined;
  spawnAndCaptureImpl = spawnAndCaptureBase;
}

async function runClaudeExec(options: ClaudeExecOptions): Promise<ClaudeExecResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "srgical-claude-"));
  const promptFile = path.join(tempDir, "prompt.txt");
  const command = await resolveClaudeCommand();
  const args = ["-p", "--output-format", "text", "--permission-mode", options.permissionMode];

  await writeFile(promptFile, options.prompt, "utf8");
  args.push("--append-system-prompt-file", promptFile);

  if (options.allowedTools && options.allowedTools.length > 0) {
    const settingsFile = path.join(tempDir, "settings.json");
    await writeFile(
      settingsFile,
      JSON.stringify(
        {
          permissions: {
            allow: options.allowedTools
          }
        },
        null,
        2
      ),
      "utf8"
    );
    args.push("--settings", settingsFile);
  }

  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }

  args.push("--no-session-persistence", FOLLOW_APPENDED_PROMPT_QUERY);

  try {
    const result = await spawnAndCaptureImpl(command, args, options.cwd, undefined, {
      onStdoutChunk: options.onOutputChunk
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      lastMessage: result.stdout.trim()
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function resolveClaudeCommand(): Promise<string> {
  if (forcedClaudeCommand) {
    return forcedClaudeCommand;
  }

  if (!claudeCommandPromise) {
    claudeCommandPromise = loadClaudeCommand();
  }

  return claudeCommandPromise;
}

async function loadClaudeCommand(): Promise<string> {
  if (process.platform !== "win32") {
    return "claude";
  }

  const result = await spawnAndCaptureImpl("where.exe", ["claude"], process.cwd());
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

  throw new Error("Unable to resolve a Claude executable path.");
}

function spawnAndCaptureBase(
  command: string,
  args: string[],
  cwd: string,
  stdinText?: string,
  options: SpawnCaptureOptions = {}
): Promise<SpawnCaptureResult> {
  return new Promise((resolve, reject) => {
    const spec = buildSpawnSpec(command, args, cwd);
    const child = spawn(spec.command, spec.args, spec.options);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdoutChunk?.(text);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderrChunk?.(text);
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

function normalizeClaudeDetectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Failed to run claude";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find files for the given pattern") ||
    normalized.includes("unable to resolve a claude executable path") ||
    normalized.includes("'claude' is not recognized") ||
    normalized.includes("enoent")
  ) {
    return CLAUDE_INSTALL_HINT;
  }

  return message;
}

function isClaudeUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("unable to resolve a claude executable path") ||
    message.includes("'claude' is not recognized") ||
    message.includes("enoent") ||
    message.includes("failed to run claude")
  );
}

function appendPlanningEpochSummary(preparation: PlanningEpochPreparation, summary: string): string {
  const epochSummary = formatPlanningEpochSummary(preparation);
  return [epochSummary, summary].filter(Boolean).join("\n");
}
