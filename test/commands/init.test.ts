import test from "node:test";
import assert from "node:assert/strict";
import { runInitCommand } from "../../src/commands/init";
import { readPlanningPackState } from "../../src/core/planning-pack-state";
import { loadPlanningState } from "../../src/core/planning-state";
import { saveStudioSession } from "../../src/core/studio-session";
import { captureStdout } from "../helpers/capture";
import { createTempWorkspace } from "../helpers/workspace";
import { getPlanningPackPaths, readActivePlanId, readText, writeText } from "../../src/core/workspace";
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
  assert.match(await readText(paths.plan), /## SRGICAL META/);
  assert.match(await readText(paths.plan), /Pending first authored draft\./);
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

test("init --force clears stale studio and advice state for a re-scaffolded plan", async () => {
  const workspace = await createTempWorkspace("srgical-init-force-reset-");
  const paths = await getOrCreateScaffold(workspace, "proto");

  await saveStudioSession(
    workspace,
    [
      {
        role: "user",
        content: "We need to define the repo scope, the main delivery constraints, and the first execution slice."
      },
      {
        role: "assistant",
        content:
          "The repo already contains the CLI surface, so the first grounded slice should focus on making planning-pack state deterministic and easy to inspect."
      },
      {
        role: "user",
        content: "Yes, go with that and write the pack."
      },
      {
        role: "assistant",
        content:
          "That gives us enough goal, repo context, constraints, and an initial executable slice to move from scaffold into a grounded first draft."
      }
    ],
    { planId: "proto" }
  );

  await writeText(
    paths.adviceState,
    JSON.stringify(
      {
        version: 1,
        planId: "proto",
        updatedAt: "2026-04-03T00:00:00.000Z",
        problemStatement: "stale",
        clarity: "clear",
        stateAssessment: "stale",
        researchNeeded: [],
        advice: "stale",
        nextAction: "stale"
      },
      null,
      2
    )
  );

  await runInitCommand(workspace, true, "proto");

  const state = await readPlanningPackState(workspace, { planId: "proto" });

  assert.equal(state.docsPresent, 0);
  assert.equal(state.readiness.score, 0);
  assert.equal(state.advice, null);
});

async function getOrCreateScaffold(workspace: string, planId: string) {
  await runInitCommand(workspace, false, planId);
  return getPlanningPackPaths(workspace, { planId });
}

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
