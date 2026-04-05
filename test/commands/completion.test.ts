import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { writePlanningPack } from "../helpers/workspace";

test("hidden completion suggests matching plans for prepare positional plan ids", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-complete-prepare-"));
  await writePlanningPack(workspace, { planId: "proto" });
  await writePlanningPack(workspace, { planId: "prototype" });
  await writePlanningPack(workspace, { planId: "release" });

  const result = await runCli(["src/index.ts", "__complete", "--index", "1", "--", "prepare", "prot"], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(splitLines(result.stdout), ["proto", "prototype"]);
});

test("hidden completion suggests matching plans for --plan options", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-complete-option-"));
  await writePlanningPack(workspace, { planId: "proto" });
  await writePlanningPack(workspace, { planId: "prototype" });
  await writePlanningPack(workspace, { planId: "release" });

  const result = await runCli(["src/index.ts", "__complete", "--index", "2", "--", "operate", "--plan", "prot"], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(splitLines(result.stdout), ["proto", "prototype"]);
});

test("hidden completion suggests matching plans for status positional plan ids", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-complete-status-"));
  await writePlanningPack(workspace, { planId: "proto" });
  await writePlanningPack(workspace, { planId: "prototype" });

  const result = await runCli(["src/index.ts", "__complete", "--index", "1", "--", "status", "prot"], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(splitLines(result.stdout), ["proto", "prototype"]);
});

test("hidden completion stays quiet for commands that should not force existing plan ids", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-complete-init-"));
  await writePlanningPack(workspace, { planId: "proto" });

  const result = await runCli(["src/index.ts", "__complete", "--index", "1", "--", "init", "prot"], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), "");
});

test("completion bash prints a bash completion script", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-complete-bash-"));

  const result = await runCli(["src/index.ts", "completion", "bash"], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /_srgical_completion\(\)/);
  assert.match(result.stdout, /srgical __complete --index "\$index" -- "\$\{args\[@\]\}"/);
  assert.match(result.stdout, /complete -F _srgical_completion srgical/);
});

test("completion powershell prints a PowerShell completion script", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-complete-pwsh-"));

  const result = await runCli(["src/index.ts", "completion", "powershell"], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Register-ArgumentCompleter -Native -CommandName srgical -ScriptBlock/);
  assert.match(result.stdout, /param\(\$wordToComplete, \$commandAst, \$cursorPosition\)/);
  assert.match(result.stdout, /srgical __complete --index \$index -- @elements/);
});

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function runCli(args: string[], cwd: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const resolvedArgs = args.map((arg, index) => (index === 0 ? path.resolve(process.cwd(), arg) : arg));
    const tsxLoaderUrl = pathToFileURL(path.resolve(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs")).href;
    const child = spawn(process.execPath, ["--import", tsxLoaderUrl, ...resolvedArgs], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SRGICAL_DISABLE_UPDATE_CHECK: "true"
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
