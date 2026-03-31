import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  loadStudioOperateConfig,
  loadStudioOperateGuidanceSnapshot,
  sanitizeReferencePaths,
  saveStudioOperateConfig
} from "../../src/core/studio-operate-config";
import { writeText } from "../../src/core/workspace";
import { createTempWorkspace } from "../helpers/workspace";

test("studio-operate-config defaults to pause disabled and no references", async () => {
  const workspace = await createTempWorkspace("srgical-operate-config-defaults-");

  const config = await loadStudioOperateConfig(workspace, { planId: "release-readiness" });

  assert.equal(config.pauseForPr, false);
  assert.deepEqual(config.referencePaths, []);
});

test("save-studio-operate-config normalizes and de-duplicates reference paths", async () => {
  const workspace = await createTempWorkspace("srgical-operate-config-save-");

  const saved = await saveStudioOperateConfig(
    workspace,
    {
      pauseForPr: true,
      referencePaths: ["docs\\prompt.md", "docs/prompt.md", " docs/standards.md "]
    },
    { planId: "release-readiness" }
  );

  assert.equal(saved.pauseForPr, true);
  assert.deepEqual(saved.referencePaths, ["docs/prompt.md", "docs/standards.md"]);
});

test("load-studio-operate-guidance-snapshot reads configured docs and reports missing paths", async () => {
  const workspace = await createTempWorkspace("srgical-operate-config-guidance-");
  const docsDir = path.join(workspace, "docs", "guidelines");
  await mkdir(docsDir, { recursive: true });
  await writeText(path.join(workspace, "docs", "prompt.md"), "Prompt guidance");
  await writeText(path.join(docsDir, "policy.md"), "Policy guidance");
  await writeText(path.join(docsDir, "notes.bin"), "\u0000\u0001");

  await saveStudioOperateConfig(
    workspace,
    {
      referencePaths: ["docs/prompt.md", "docs/guidelines", "docs/missing.md"]
    },
    { planId: "release-readiness" }
  );

  const snapshot = await loadStudioOperateGuidanceSnapshot(workspace, { planId: "release-readiness" });

  assert.equal(snapshot.docs.length, 2);
  assert.match(snapshot.docs[0]?.displayPath ?? "", /docs\/prompt\.md/);
  assert.match(snapshot.docs[1]?.displayPath ?? "", /docs\/guidelines\/policy\.md/);
  assert.match(snapshot.warnings.join("\n"), /Missing reference path: docs\/missing\.md/);
});

test("sanitize-reference-paths keeps stable order while trimming and deduping", () => {
  assert.deepEqual(sanitizeReferencePaths(["", " a ", "A", "b\\c", "b/c"]), ["a", "b/c"]);
});
