import test from "node:test";
import assert from "node:assert/strict";
import { runInitCommand } from "../../src/commands/init";
import { loadPlanningState } from "../../src/core/planning-state";
import { captureStdout } from "../helpers/capture";
import { createTempWorkspace } from "../helpers/workspace";
import { getPlanningPackPaths, readActivePlanId } from "../../src/core/workspace";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

test("init --plan creates a named planning pack and activates it", async () => {
  const workspace = await createTempWorkspace("srgical-init-named-");

  const output = await captureStdout(async () => {
    await runInitCommand(workspace, false, "release-readiness");
  });

  const paths = getPlanningPackPaths(workspace, { planId: "release-readiness" });
  const planningState = await loadPlanningState(workspace, { planId: "release-readiness" });

  assert.match(output, /Created planning pack for plan `release-readiness`/);
  assert.equal(await readActivePlanId(workspace), "release-readiness");
  assert.equal(planningState?.packMode, "scaffolded");
  assert.match(paths.relativeDir, /\.srgical\/plans\/release-readiness/);
});

test("init without --plan fails because an explicit named plan is required", async () => {
  const workspace = await createTempWorkspace("srgical-init-missing-plan-");

  await assert.rejects(
    () => runInitCommand(workspace),
    /requires an explicit named plan/i
  );
});

test("init accepts a positional plan id", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-init-cli-"));

  const result = await runCli(["src/index.ts", "init", "release-readiness"], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Created planning pack for plan `release-readiness`/);

  const paths = getPlanningPackPaths(workspace, { planId: "release-readiness" });
  const planningState = await loadPlanningState(workspace, { planId: "release-readiness" });

  assert.equal(await readActivePlanId(workspace), "release-readiness");
  assert.equal(planningState?.packMode, "scaffolded");
  assert.match(paths.relativeDir, /\.srgical\/plans\/release-readiness/);
});

test("init still treats an existing directory positional arg as workspace", async () => {
  const workspace = await createTempWorkspace("srgical-init-existing-workspace-");

  const result = await runCli(["src/index.ts", "init", workspace], process.cwd());

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /requires an explicit named plan/i);
});

function runCli(args: string[], cwd: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const resolvedArgs = args.map((arg, index) => (index === 0 ? path.resolve(process.cwd(), arg) : arg));
    const tsxLoaderUrl = pathToFileURL(path.resolve(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs")).href;
    const child = spawn(process.execPath, ["--import", tsxLoaderUrl, ...resolvedArgs], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
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
