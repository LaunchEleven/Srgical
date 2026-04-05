import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  clampScrollableScrollPosition,
  getScrollablePageStep,
  getPreferredStudioMouseOptions,
  getStudioPalette,
  handleTranscriptNavigationKey,
  limitStudioSnippet,
  normalizeStudioStreamChunk,
  renderPlanningAdviceTranscript,
  renderStudioInputContent,
  resolveStudioInputCursor,
  renderStudioTranscript,
  renderCommandSyntaxHelpText,
  renderOperateHelpText,
  renderPrepareHelpText,
  selectAutoGatherFiles,
  shouldStickScrollableToBottom
} from "../../src/ui/studio";
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

test("renderStudioInputContent escapes user text without appending a second fake cursor", () => {
  assert.equal(renderStudioInputContent("Let"), "Let");
  assert.equal(renderStudioInputContent("Let "), "Let\u00a0");
  assert.equal(renderStudioInputContent("a b"), "a\u00a0b");
  const escaped = renderStudioInputContent("{bold}x{/bold}");
  assert.match(escaped, /x/);
  assert.doesNotMatch(escaped, /_$/);
});

test("normalizeStudioStreamChunk flattens carriage-return updates into transcript-friendly lines", () => {
  assert.equal(normalizeStudioStreamChunk("a\r\nb\rc"), "a\nb\nc");
});

test("renderPlanningAdviceTranscript turns parsed advice into a readable transcript summary", () => {
  const rendered = renderPlanningAdviceTranscript({
    problemStatement: "Build a single-page beta distribution demo.",
    clarity: "mostly clear",
    stateAssessment: "The user intent is clear but the repo integration target is still ambiguous.",
    researchNeeded: ["Confirm whether this is standalone or integrated."],
    advice: "Lock the target before drafting tracker slices.",
    nextAction: "Confirm the integration target."
  });

  assert.match(rendered, /Gathered context review\./);
  assert.match(rendered, /Problem: Build a single-page beta distribution demo\./);
  assert.match(rendered, /Clarity: mostly clear/);
  assert.match(rendered, /Research needed:/);
  assert.match(rendered, /Next action: Confirm the integration target\./);
});

test("renderStudioTranscript applies the role colors and escapes transcript content", () => {
  const rendered = renderStudioTranscript([
    { role: "assistant", content: "AI says hi." },
    { role: "user", content: "{bold}user{/bold}" },
    { role: "system", content: "System note." }
  ]);

  assert.match(rendered, /\{#fde047-fg\}AI\{\/\}/);
  assert.match(rendered, /\{#4ade80-fg\}YOU\{\/\}/);
  assert.match(rendered, /\{#60a5fa-fg\}SYSTEM\{\/\}/);
  assert.doesNotMatch(rendered, /\{bold\}user\{\/bold\}/);
});

test("resolveStudioInputCursor keeps the terminal caret inside the visible message box", () => {
  assert.deepEqual(resolveStudioInputCursor([""], 4, 12), { rowOffset: 0, colOffset: 0 });
  assert.deepEqual(resolveStudioInputCursor(["hello"], 4, 12), { rowOffset: 0, colOffset: 5 });
  assert.deepEqual(resolveStudioInputCursor(["123456789012345"], 4, 6), { rowOffset: 0, colOffset: 5 });
  assert.deepEqual(resolveStudioInputCursor(["line 1", "line 2", "line 3"], 2, 20), { rowOffset: 1, colOffset: 6 });
});

test("shouldStickScrollableToBottom keeps the transcript pinned when it already fits or is near the end", () => {
  assert.equal(shouldStickScrollableToBottom({
    height: 24,
    iheight: 4,
    getScrollHeight: () => 18,
    getScrollPerc: () => 0
  }), true);

  assert.equal(shouldStickScrollableToBottom({
    height: 24,
    iheight: 4,
    getScrollHeight: () => 80,
    getScrollPerc: () => 99
  }), true);

  assert.equal(shouldStickScrollableToBottom({
    height: 24,
    iheight: 4,
    getScrollHeight: () => 80,
    getScrollPerc: () => 98.5
  }), false);
});

test("shouldStickScrollableToBottom defaults to sticky when blessed has not resolved numeric layout yet", () => {
  assert.equal(shouldStickScrollableToBottom({
    height: "100%-10",
    iheight: 4,
    getScrollHeight: () => 80,
    getScrollPerc: () => 0
  }), true);
});

test("getScrollablePageStep uses the visible transcript height and never drops below one line", () => {
  assert.equal(getScrollablePageStep({
    height: 24,
    iheight: 4
  }), 19);

  assert.equal(getScrollablePageStep({
    height: 3,
    iheight: 4
  }), 1);

  assert.equal(getScrollablePageStep({
    height: "100%-10",
    iheight: 4
  }), 1);
});

test("getPreferredStudioMouseOptions opts into modern mouse reporting", () => {
  assert.deepEqual(getPreferredStudioMouseOptions(), {
    vt200Mouse: true,
    allMotion: true,
    sgrMouse: true,
    sendFocus: true
  });
});

test("getStudioPalette makes prepare and operate feel visually distinct", () => {
  const prepare = getStudioPalette("prepare");
  const operate = getStudioPalette("operate");

  assert.equal(prepare.transcriptLabel, " Prepare Transcript ");
  assert.equal(operate.transcriptLabel, " Operate Transcript ");
  assert.notEqual(prepare.headerBg, operate.headerBg);
  assert.notEqual(prepare.transcriptBorder, operate.transcriptBorder);
  assert.notEqual(prepare.inputLabel, operate.inputLabel);
});

test("clampScrollableScrollPosition preserves a valid viewport offset", () => {
  assert.equal(clampScrollableScrollPosition(10, 50, 20), 10);
  assert.equal(clampScrollableScrollPosition(-3, 50, 20), 0);
  assert.equal(clampScrollableScrollPosition(80, 12, 6), 6);
  assert.equal(clampScrollableScrollPosition(4, 5, 8), 0);
});

test("handleTranscriptNavigationKey maps paging keys into transcript navigation actions", () => {
  const calls: string[] = [];
  const handledPageUp = handleTranscriptNavigationKey(
    { name: "pageup" },
    (direction) => { calls.push(`page:${direction}`); },
    (target) => { calls.push(`jump:${target}`); }
  );
  const handledHome = handleTranscriptNavigationKey(
    { name: "home" },
    (direction) => { calls.push(`page:${direction}`); },
    (target) => { calls.push(`jump:${target}`); }
  );
  const handledOther = handleTranscriptNavigationKey(
    { name: "enter" },
    (direction) => { calls.push(`page:${direction}`); },
    (target) => { calls.push(`jump:${target}`); }
  );

  assert.equal(handledPageUp, true);
  assert.equal(handledHome, true);
  assert.equal(handledOther, false);
  assert.deepEqual(calls, ["page:-1", "jump:top"]);
});

test("prepare help explains slice options and compatibility aliases", () => {
  const help = renderPrepareHelpText();

  assert.match(help, /Plain text without a prefix is normal planning chat/);
  assert.match(help, /Commands start with `:`/);
  assert.match(help, /`:slice`: slice the current draft using the recommended preset \(`high \+ spike`\)/);
  assert.match(help, /`:slice \[low\|medium\|high\] \[spike\]`: override slice settings for this run/);
  assert.match(help, /`:slice --help`: show the slice arguments, defaults, and examples/);
  assert.match(help, /`:help commands`: explain the `:` command syntax quickly/);
  assert.match(help, /`\/dice \.\.\.`: legacy compatibility alias for slicing/);
});

test("operate help explains the execution-focused command descriptions", () => {
  const help = renderOperateHelpText();

  assert.match(help, /Plain text chat is disabled here so execution stays action-first/);
  assert.match(help, /Commands start with `:`/);
  assert.match(help, /`:run`: execute the next queued step once/);
  assert.match(help, /`:auto \[n\]`: continue automatically for up to `n` steps/);
  assert.match(help, /`:checkpoint`: toggle PR checkpoint mode on or off/);
  assert.match(help, /`:help commands`: explain the `:` command syntax quickly/);
  assert.match(help, /`:unblock`: move the current blocked step back to `todo` with retry notes/);
});

test("command syntax help explains that :command is not literal in prepare mode", () => {
  const help = renderCommandSyntaxHelpText("prepare");

  assert.match(help, /There is no literal `:command` command/);
  assert.match(help, /In prepare, plain text is normal chat with the planner/);
  assert.match(help, /Examples: `:help`, `:slice --help`, `:build`, `:run`, `:auto 3`/);
  assert.match(help, /Old slash commands are retired/);
});

test("command syntax help explains operate mode stays command-first", () => {
  const help = renderCommandSyntaxHelpText("operate");

  assert.match(help, /There is no literal `:command` command/);
  assert.match(help, /In operate, plain text chat is disabled so commands stay explicit/);
});
