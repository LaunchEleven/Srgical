import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  addReferenceRoot,
  listReferenceDirectoryOptions,
  loadReferenceCatalog,
  loadReferenceRoots,
  loadSelectedReferenceDocuments,
  removeReferenceRoot,
  recommendReferences,
  saveSelectedReferenceIds
} from "../../src/core/reference-library";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("recommendReferences ranks guidance using plan and repo signals", () => {
  const recommendations = recommendReferences(
    [
      {
        id: "docs/testing-guide.md",
        title: "Testing Guide",
        summary: "Vitest and coverage expectations for changes.",
        path: "docs/testing-guide.md",
        tags: ["testing"]
      },
      {
        id: "docs/architecture.md",
        title: "Architecture Notes",
        summary: "Seams and boundaries across the monorepo.",
        path: "docs/architecture.md",
        tags: ["architecture"]
      }
    ],
    {
      planId: "test-coverage-improvements",
      evidence: ["apps/cli/test/core/prompts.test.ts"],
      unknowns: ["Need better testing confidence around prompt changes."],
      messages: [{ role: "user", content: "Let's tighten testing guidance for this rollout." }]
    }
  );

  assert.equal(recommendations[0]?.id, "docs/testing-guide.md");
  assert.match(recommendations[0]?.reason ?? "", /testing/i);
});

test("loadSelectedReferenceDocuments returns selected guidance snippets", async () => {
  const workspace = await createTempWorkspace("srgical-reference-library-");
  await writePlanningPack(workspace, { planId: "proto" });
  await writeFile(
    path.join(workspace, "README.md"),
    "# Repo Playbook\n\nUse this guidance for architecture and testing decisions.",
    "utf8"
  );
  await saveSelectedReferenceIds(workspace, ["readme.md"], { planId: "proto" });

  const catalog = await loadReferenceCatalog(workspace, { planId: "proto" });
  assert.equal(catalog.some((entry) => entry.id === "readme.md" && entry.selected), true);

  const selected = await loadSelectedReferenceDocuments(workspace, { planId: "proto" }, 120);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.title, "Repo Playbook");
  assert.match(selected[0]?.contentSnippet ?? "", /architecture and testing/i);
});

test("custom reference roots are stored and scanned for additional docs", async () => {
  const workspace = await createTempWorkspace("srgical-reference-roots-");
  await writePlanningPack(workspace, { planId: "proto" });
  await writeFile(path.join(workspace, "playbooks", "release.md"), "# Release Guide\n\nUse this during rollout.", "utf8").catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(workspace, "playbooks"), { recursive: true });
    await writeFile(path.join(workspace, "playbooks", "release.md"), "# Release Guide\n\nUse this during rollout.", "utf8");
  });

  await addReferenceRoot(workspace, "playbooks", { planId: "proto" });
  assert.deepEqual(await loadReferenceRoots(workspace, { planId: "proto" }), ["playbooks"]);

  const catalog = await loadReferenceCatalog(workspace, { planId: "proto" });
  assert.equal(catalog.some((entry) => entry.path === "playbooks/release.md"), true);

  await removeReferenceRoot(workspace, "playbooks", { planId: "proto" });
  assert.deepEqual(await loadReferenceRoots(workspace, { planId: "proto" }), []);
});

test("listReferenceDirectoryOptions returns browsable repo directories", async () => {
  const workspace = await createTempWorkspace("srgical-reference-browser-");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(workspace, "docs", "playbooks"), { recursive: true });
  await mkdir(path.join(workspace, "REFERENCE", "standards"), { recursive: true });

  const root = await listReferenceDirectoryOptions(workspace);
  assert.equal(root.directories.some((entry) => entry.path === "docs"), true);
  assert.equal(root.directories.some((entry) => entry.path === "REFERENCE"), true);

  const nested = await listReferenceDirectoryOptions(workspace, "docs");
  assert.equal(nested.currentPath, "docs");
  assert.equal(nested.parentPath, "");
  assert.equal(nested.directories.some((entry) => entry.path === "docs/playbooks"), true);
});
