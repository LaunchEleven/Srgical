import test from "node:test";
import assert from "node:assert/strict";
import { runChangelogCommand } from "../../src/commands/changelog";
import { captureStdout } from "../helpers/capture";

test("changelog points the installed package at release notes and the local changelog", async () => {
  const output = await captureStdout(() => {
    runChangelogCommand();
  });

  assert.match(output, /Installed version: 0\.0\.0/);
  assert.match(output, /Release notes: https:\/\/github\.com\/LaunchEleven\/Srgical\/releases\/tag\/v0\.0\.0/);
  assert.match(output, /All releases: https:\/\/github\.com\/LaunchEleven\/Srgical\/releases/);
  assert.match(output, /Local CHANGELOG\.md:/);
  assert.match(output, /Tip: run `srgical version` to confirm exactly which release is installed\./);
});
