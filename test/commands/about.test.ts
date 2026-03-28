import test from "node:test";
import assert from "node:assert/strict";
import { runAboutCommand } from "../../src/commands/about";
import { captureStdout } from "../helpers/capture";

test("about reports package, release, and agent information", async () => {
  const output = await captureStdout(() => {
    runAboutCommand();
  });

  assert.match(output, /^srgical$/m);
  assert.match(output, /Version: 0\.0\.0/);
  assert.match(output, /Package: @launcheleven\/srgical/);
  assert.match(output, /Repository: https:\/\/github\.com\/LaunchEleven\/Srgical/);
  assert.match(output, /Release notes: https:\/\/github\.com\/LaunchEleven\/Srgical\/releases\/tag\/v0\.0\.0/);
  assert.match(output, /Supported agents: codex, claude, augment/);
  assert.match(output, /Next steps: `srgical doctor`, `srgical studio`, or `srgical changelog`/);
});
