import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { runStudioConfigCommand } from "../../src/commands/studio-config";
import { loadStudioOperateConfig } from "../../src/core/studio-operate-config";
import { writeText } from "../../src/core/workspace";
import { captureStdout } from "../helpers/capture";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("studio config saves pause-for-pr and reference paths", async () => {
  const workspace = await createTempWorkspace("srgical-studio-config-command-");
  await writePlanningPack(workspace, { planId: "release-readiness" });

  const docsDir = path.join(workspace, "docs");
  await mkdir(docsDir, { recursive: true });
  await writeText(path.join(docsDir, "operate-guidelines.md"), "Keep PRs narrow and validated.");

  const output = await captureStdout(async () => {
    await runStudioConfigCommand(workspace, {
      planId: "release-readiness",
      pausePr: true,
      setReference: ["docs/operate-guidelines.md"]
    });
  });

  const config = await loadStudioOperateConfig(workspace, { planId: "release-readiness" });

  assert.equal(config.pauseForPr, true);
  assert.deepEqual(config.referencePaths, ["docs/operate-guidelines.md"]);
  assert.match(output, /Saved studio operate config for plan `release-readiness`\./);
  assert.match(output, /Pause for PR: enabled/);
  assert.match(output, /Loaded reference docs this run: 1/);
});

test("studio config shows current settings when no edits are provided", async () => {
  const workspace = await createTempWorkspace("srgical-studio-config-command-show-");
  await writePlanningPack(workspace, { planId: "release-readiness" });

  const output = await captureStdout(async () => {
    await runStudioConfigCommand(workspace, {
      planId: "release-readiness"
    });
  });

  assert.match(output, /Showing studio operate config for plan `release-readiness`\./);
  assert.match(output, /Pause for PR: disabled/);
});
