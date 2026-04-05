import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runInitCommand } from "../../src/commands/init";
import { ensurePreparePack } from "../../src/core/prepare-pack";
import { readPlanningPackState } from "../../src/core/planning-pack-state";
import { ensurePlanningDir, readActivePlanId, readText, writeText } from "../../src/core/workspace";
import { createTempWorkspace } from "../helpers/workspace";

test("ensurePreparePack creates the new prepare pack files and activates the plan", async () => {
  const workspace = await createTempWorkspace("srgical-prepare-pack-");

  const paths = await ensurePreparePack(workspace, { planId: "release-readiness" });
  const state = await readPlanningPackState(workspace, { planId: "release-readiness" });
  const manifest = JSON.parse(await readText(paths.manifest)) as { stage: string; nextAction: string };

  assert.equal(await readActivePlanId(workspace), "release-readiness");
  assert.match(paths.relativeDir, /\.srgical\/plans\/release-readiness/);
  assert.match(await readText(paths.plan), /## Desired Outcome/);
  assert.match(await readText(paths.context), /## Repo Truth/);
  assert.match(await readText(paths.tracker), /- Next step: `DISCOVER-001`/);
  assert.match(await readText(paths.changes), /Created the initial prepare pack\./);
  assert.equal(manifest.stage, "discover");
  assert.match(manifest.nextAction, /Gather more evidence/i);
  assert.equal(state.mode, "Discover");
  assert.equal(state.currentPosition.nextRecommended, "DISCOVER-001");
  assert.equal(state.manifest?.stage, "discover");
});

test("ensurePreparePack rejects legacy-only packs in the rebooted release", async () => {
  const workspace = await createTempWorkspace("srgical-legacy-pack-");
  const paths = await ensurePlanningDir(workspace, { planId: "proto" });

  await writeText(path.join(paths.dir, "01-product-plan.md"), "# Legacy Plan\n");
  await writeText(path.join(paths.dir, "02-agent-context-kickoff.md"), "# Legacy Context\n");
  await writeText(path.join(paths.dir, "03-detailed-implementation-plan.md"), "# Legacy Tracker\n");

  await assert.rejects(
    () => ensurePreparePack(workspace, { planId: "proto" }),
    /Legacy plan packs using `01-product-plan\.md` \/ `HandoffDoc\.md` are intentionally unsupported in this release\./
  );
});

test("init is kept only to explain the rebooted workflow", async () => {
  await assert.rejects(() => runInitCommand(), /Use `srgical prepare <id>` instead\./);
});

test("the legacy init CLI exits with migration guidance", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-init-cli-"));
  const result = await runCli(["src/index.ts", "init", "release-readiness"], workspace);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Use `srgical prepare <id>` instead\./);
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
