import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

test("launcher help exposes the browser host without terminal workflow commands", async () => {
  const result = await runCli(["--help"], process.cwd());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /browser-first local workspace/);
  assert.match(result.stdout, /\[workspace\]/);
  assert.doesNotMatch(result.stdout, /^\s+(prepare|operate|status|completion)\s/m);
});

test("retired terminal commands point users to the browser workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-retired-command-"));
  const result = await runCli(["prepare", "release-readiness"], workspace);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /terminal workflow has been retired/);
  assert.match(result.stderr, /srgical \[working-directory\]/);
});

function runCli(args: string[], cwd: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const entrypoint = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
    const require = createRequire(import.meta.url);
    const tsxLoaderUrl = pathToFileURL(require.resolve("tsx")).href;
    const child = spawn(process.execPath, ["--import", tsxLoaderUrl, entrypoint, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
