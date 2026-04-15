import test from "node:test";
import assert from "node:assert/strict";
import { captureSourcesInContext } from "../../src/core/context-refresh";

test("captureSourcesInContext appends imported source snapshots with full source text", () => {
  const context = [
    "# Context",
    "",
    "## Repo Truth",
    "",
    "- Repo scaffold exists.",
    "",
    "## Evidence Gathered",
    "",
    "- Imported spec is pending sync."
  ].join("\n");
  const updated = captureSourcesInContext(
    context,
    [
      {
        path: "geo_brief_implementation_spec.md",
        content: `# Geo Brief\n\n\`\`\`md\nembedded fence\n\`\`\`\n\n${"A".repeat(5000)}\nTAIL_MARKER`
      }
    ],
    "2026-04-13T00:00:00.000Z"
  );

  assert.match(updated, /## Imported Source Snapshots/);
  assert.match(updated, /### Source: `geo_brief_implementation_spec\.md`/);
  assert.match(updated, /Captured: 2026-04-13T00:00:00.000Z/);
  assert.match(updated, /````markdown/);
  assert.match(updated, /TAIL_MARKER/);
});

test("captureSourcesInContext replaces an existing source snapshot instead of duplicating it", () => {
  const initial = captureSourcesInContext(
    "# Context\n\n## Evidence Gathered\n\n- Initial.",
    [{ path: "notes/spec.md", content: "OLD_CONTENT" }],
    "2026-04-13T00:00:00.000Z"
  );

  const updated = captureSourcesInContext(
    initial,
    [
      { path: "notes/spec.md", content: "NEW_CONTENT" },
      { path: "notes/extra.md", content: "EXTRA_CONTENT" }
    ],
    "2026-04-13T01:00:00.000Z"
  );

  assert.equal((updated.match(/### Source: `notes\/spec\.md`/g) ?? []).length, 1);
  assert.match(updated, /NEW_CONTENT/);
  assert.doesNotMatch(updated, /OLD_CONTENT/);
  assert.match(updated, /### Source: `notes\/extra\.md`/);
});
