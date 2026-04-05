import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { limitStudioSnippet, selectAutoGatherFiles } from "../../src/ui/studio";
import { createTempWorkspace } from "../helpers/workspace";

test("selectAutoGatherFiles only returns existing evidence files and respects the cap", async () => {
  const workspace = await createTempWorkspace("srgical-studio-gather-files-");
  await mkdir(path.join(workspace, "docs"), { recursive: true });
  await mkdir(path.join(workspace, "src", "nested"), { recursive: true });
  await mkdir(path.join(workspace, "test"), { recursive: true });

  await writeFile(path.join(workspace, "package.json"), "{\"name\":\"demo\"}", "utf8");
  await writeFile(path.join(workspace, "README.md"), "# Demo", "utf8");
  await writeFile(path.join(workspace, "docs", "product-foundation.md"), "# Product Foundation", "utf8");
  await writeFile(path.join(workspace, "src", "alpha.ts"), "export const alpha = 1;\n", "utf8");
  await writeFile(path.join(workspace, "src", "nested", "beta.ts"), "export const beta = 2;\n", "utf8");
  await writeFile(path.join(workspace, "test", "alpha.test.ts"), "test('alpha', () => {});\n", "utf8");
  await writeFile(path.join(workspace, "test", "beta.test.ts"), "test('beta', () => {});\n", "utf8");

  const files = await selectAutoGatherFiles(workspace);

  assert.ok(files.length <= 6);
  assert.deepEqual(files.slice(0, 3), ["package.json", "README.md", "docs/product-foundation.md"]);
  assert.ok(files.includes("src/alpha.ts"));
  assert.ok(files.includes("src/nested/beta.ts"));
  assert.ok(!files.includes("docs/missing.md"));
});

test("limitStudioSnippet leaves short content alone and truncates long content clearly", () => {
  assert.equal(limitStudioSnippet("short"), "short");

  const long = "a".repeat(1700);
  const clipped = limitStudioSnippet(long);

  assert.ok(clipped.length < long.length);
  assert.match(clipped, /\.\.\. \[truncated after 1600 chars\]$/);
});
