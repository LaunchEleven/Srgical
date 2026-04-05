import test from "node:test";
import assert from "node:assert/strict";
import { runStudioConfigCommand } from "../../src/commands/studio-config";
import { runStudioCommand, runStudioOperateCommand, runStudioPlanCommand } from "../../src/commands/studio";

test("legacy studio entrypoints explain the reboot replacements", async () => {
  await assert.rejects(() => runStudioCommand(), /Use `srgical prepare <id>` instead\./);
  await assert.rejects(() => runStudioPlanCommand(), /Use `srgical prepare <id>` instead\./);
  await assert.rejects(() => runStudioOperateCommand(), /Use `srgical operate <id>` instead\./);
});

test("legacy studio-config explains the new checkpoint-oriented replacement", async () => {
  await assert.rejects(() => runStudioConfigCommand(), /Use `srgical operate <id> --checkpoint` instead\./);
});
