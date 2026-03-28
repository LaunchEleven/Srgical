import test from "node:test";
import assert from "node:assert/strict";
import { renderVersionSummary, runVersionCommand } from "../../src/commands/version";
import { captureStdout } from "../helpers/capture";

test("render-version-summary adds release context to the installed version", () => {
  const output = renderVersionSummary();

  assert.match(output, /^srgical 0\.0\.0$/m);
  assert.match(output, /Package: @launcheleven\/srgical/);
  assert.match(output, /Release notes: https:\/\/github\.com\/LaunchEleven\/Srgical\/releases\/tag\/v0\.0\.0/);
  assert.match(output, /More: run `srgical about`/);
});

test("run-version-command writes the polished version summary", async () => {
  const output = await captureStdout(() => {
    runVersionCommand();
  });

  assert.match(output, /^srgical 0\.0\.0$/m);
  assert.match(output, /All releases: https:\/\/github\.com\/LaunchEleven\/Srgical\/releases/);
});
