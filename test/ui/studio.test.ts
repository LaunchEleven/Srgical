import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAgentSelectionCommand,
  buildStudioHeaderContent,
  clampTranscriptStartIndex,
  formatPlanningPackSummary,
  formatTrackerSummary,
  getVisibleTranscriptMessages,
  removeLastWordChunk,
  shouldTreatEnterAsPastedNewline,
  shouldDeletePreviousWordFromComposer,
  parseComposerPathCompletionRequest,
  resolvePathCompletionDirectionFromKeypress,
  resolveStudioTerminal,
  resolveTranscriptScrollProfile,
  renderWorkspaceSelectionMessage,
  resolveStudioWorkspaceInput
} from "../../src/ui/studio";
import type { PlanningPackState } from "../../src/core/planning-pack-state";

test("format-planning-pack-summary makes an unwritten plan obvious", () => {
  const workspace = "G:\\code\\Launch11Projects\\demo";
  const state = createPackState({
    packPresent: false,
    trackerReadable: false,
    mode: "No Pack"
  });

  assert.match(formatPlanningPackSummary(workspace, state), /state: no pack/);
  assert.match(formatPlanningPackSummary(workspace, state), /next: \/plan new <id> to create the planning doc set/);
  assert.match(renderWorkspaceSelectionMessage(workspace, state), /plan status: no pack/);
  assert.match(buildStudioHeaderContent(workspace, state), /PLAN DEFAULT \| NO PACK/);
});

test("format-planning-pack-summary makes a written plan obvious", () => {
  const workspace = "G:\\code\\Launch11Projects\\demo";
  const state = createPackState({
    packPresent: true,
    trackerReadable: true,
    nextRecommended: "EXEC001",
    mode: "Execution Active"
  });

  assert.match(formatPlanningPackSummary(workspace, state), /state: execution active/);
  assert.match(formatPlanningPackSummary(workspace, state), /next: \/preview, \/run, or \/auto when ready/);
  assert.match(buildStudioHeaderContent(workspace, state), /PLAN DEFAULT \| EXECUTION ACTIVE/);
});

test("scaffolded ready plans guide users to first-write before confirmation", () => {
  const workspace = "G:\\code\\Launch11Projects\\demo";
  const state = createPackState({
    packPresent: true,
    trackerReadable: false,
    mode: "Ready to Write",
    packMode: "scaffolded",
    readinessReadyToWrite: true,
    humanWriteConfirmed: false
  });

  assert.match(formatPlanningPackSummary(workspace, state), /first grounded draft/);
  assert.match(renderWorkspaceSelectionMessage(workspace, state), /first grounded draft/);
});

test("format-tracker-summary shows none queued instead of unknown", () => {
  assert.equal(
    formatTrackerSummary({
      lastCompleted: "DOC002",
      nextRecommended: null,
      updatedAt: "2026-03-25T00:00:00.000Z"
    }),
    "last: DOC002\nnext: none queued\nupdated: 2026-03-25T00:00:00.000Z"
  );
});

test("resolve-studio-workspace-input resolves relative paths from the current workspace", () => {
  assert.equal(
    resolveStudioWorkspaceInput("G:\\code\\Launch11Projects\\srgical", "..\\another-repo"),
    "G:\\code\\Launch11Projects\\another-repo"
  );
  assert.equal(
    resolveStudioWorkspaceInput("G:\\code\\Launch11Projects\\srgical", "D:\\sandbox\\fresh"),
    "D:\\sandbox\\fresh"
  );
});

test("should-treat-enter-as-pasted-newline catches rapid paste bursts", () => {
  const now = 1_000;
  assert.equal(shouldTreatEnterAsPastedNewline(now - 20, 12, now), true);
});

test("should-treat-enter-as-pasted-newline ignores normal typing cadence", () => {
  const now = 1_000;
  assert.equal(shouldTreatEnterAsPastedNewline(now - 200, 12, now), false);
  assert.equal(shouldTreatEnterAsPastedNewline(now - 20, 2, now), false);
  assert.equal(shouldTreatEnterAsPastedNewline(null, 12, now), false);
});

test("remove-last-word-chunk trims the previous word and trailing whitespace", () => {
  assert.equal(removeLastWordChunk(""), "");
  assert.equal(removeLastWordChunk("hello"), "");
  assert.equal(removeLastWordChunk("hello world"), "hello ");
  assert.equal(removeLastWordChunk("hello world   "), "hello ");
});

test("should-delete-previous-word-from-composer supports common terminal shortcuts", () => {
  assert.equal(shouldDeletePreviousWordFromComposer({ name: "w", ctrl: true, meta: false, full: "C-w", sequence: "\u0017" }), true);
  assert.equal(
    shouldDeletePreviousWordFromComposer({ name: "backspace", ctrl: false, meta: true, full: "M-backspace", sequence: "\u001b\u007f" }),
    true
  );
  assert.equal(shouldDeletePreviousWordFromComposer({ name: "backspace", ctrl: true, meta: false, full: "C-backspace", sequence: "\b" }), true);
  assert.equal(shouldDeletePreviousWordFromComposer({ name: "delete", ctrl: false, meta: true, full: "M-delete", sequence: "\u001b[3;3~" }), true);
  assert.equal(shouldDeletePreviousWordFromComposer({ name: "delete", ctrl: true, meta: false, full: "C-delete", sequence: "\u001b[3;5~" }), true);
  assert.equal(shouldDeletePreviousWordFromComposer({ name: "backspace", ctrl: false, meta: false, full: "backspace", sequence: "\u007f" }), false);
  assert.equal(shouldDeletePreviousWordFromComposer({ name: "x", ctrl: false, meta: false, full: "x", sequence: "x" }), false);
});

test("resolve-path-completion-direction-from-keypress handles standard tab and shift+tab", () => {
  assert.equal(
    resolvePathCompletionDirectionFromKeypress("", {
      name: "tab",
      shift: false,
      ctrl: false,
      meta: false,
      sequence: "\t",
      full: "tab"
    }),
    1
  );
  assert.equal(
    resolvePathCompletionDirectionFromKeypress("", {
      name: "tab",
      shift: true,
      ctrl: false,
      meta: false,
      sequence: "\x1b[Z",
      full: "S-tab"
    }),
    -1
  );
});

test("resolve-path-completion-direction-from-keypress handles mac ctrl+i tab variants", () => {
  assert.equal(
    resolvePathCompletionDirectionFromKeypress("\t", {
      name: "i",
      shift: false,
      ctrl: true,
      meta: false,
      sequence: "\t",
      full: "C-i"
    }),
    1
  );
});

test("resolve-path-completion-direction-from-keypress ignores non-tab keys", () => {
  assert.equal(
    resolvePathCompletionDirectionFromKeypress("a", {
      name: "a",
      shift: false,
      ctrl: false,
      meta: false,
      sequence: "a",
      full: "a"
    }),
    null
  );
});

test("parse-composer-path-completion-request extracts token and replacement range", () => {
  const readRequest = parseComposerPathCompletionRequest("/read src/ui/stu");
  assert.equal(readRequest?.command, "/read");
  assert.equal(readRequest?.token, "src/ui/stu");
  assert.equal(readRequest?.replaceStart, "/read ".length);

  const workspaceRequest = parseComposerPathCompletionRequest("/workspace ../dem");
  assert.equal(workspaceRequest?.command, "/workspace");
  assert.equal(workspaceRequest?.token, "../dem");

  assert.equal(parseComposerPathCompletionRequest("regular chat message"), null);
});

test("parse-agent-selection-command supports /agents status and /agents <id> switching", () => {
  assert.deepEqual(parseAgentSelectionCommand("/agents"), { kind: "status" });
  assert.deepEqual(parseAgentSelectionCommand("/agents augment"), { kind: "select", requestedId: "augment" });
  assert.deepEqual(parseAgentSelectionCommand("/agents CODEx"), { kind: "select", requestedId: "codex" });
});

test("parse-agent-selection-command keeps /agent as a compatibility alias", () => {
  assert.deepEqual(parseAgentSelectionCommand("/agent"), { kind: "usage" });
  assert.deepEqual(parseAgentSelectionCommand("/agent claude"), { kind: "select", requestedId: "claude" });
  assert.equal(parseAgentSelectionCommand("/agentsclaude"), null);
});

test("resolve-transcript-scroll-profile uses mac-specific labels with fallback keys", () => {
  const profile = resolveTranscriptScrollProfile("darwin");
  assert.equal(profile.footerHint, "Fn+Up/Fn+Down scroll");
  assert.match(profile.helpLine, /Fn\+Up/);
  assert.ok(profile.pageUpKeys.includes("pageup"));
  assert.ok(profile.pageDownKeys.includes("pagedown"));
  assert.ok(profile.pageUpKeys.includes("C-u"));
  assert.ok(profile.pageDownKeys.includes("C-d"));
});

test("resolve-transcript-scroll-profile uses page-up labels on non-mac platforms", () => {
  const profile = resolveTranscriptScrollProfile("win32");
  assert.equal(profile.footerHint, "PgUp/PgDn scroll");
  assert.match(profile.helpLine, /PageUp/);
  assert.ok(profile.pageUpKeys.includes("pageup"));
  assert.ok(profile.pageDownKeys.includes("pagedown"));
  assert.ok(profile.pageUpKeys.includes("C-u"));
  assert.ok(profile.pageDownKeys.includes("C-d"));
});

test("clamp-transcript-start-index keeps transcript window bounds safe", () => {
  assert.equal(clampTranscriptStartIndex(-3, 5), 0);
  assert.equal(clampTranscriptStartIndex(2, 5), 2);
  assert.equal(clampTranscriptStartIndex(999, 5), 5);
  assert.equal(clampTranscriptStartIndex(Number.NaN, 5), 0);
});

test("get-visible-transcript-messages returns only the active transcript window", () => {
  const history = [
    { role: "assistant" as const, content: "boot" },
    { role: "user" as const, content: "step one" },
    { role: "assistant" as const, content: "step two" }
  ];

  assert.deepEqual(getVisibleTranscriptMessages(history, 0), history);
  assert.deepEqual(getVisibleTranscriptMessages(history, 2), [history[2]]);
  assert.deepEqual(getVisibleTranscriptMessages(history, history.length), []);
});

test("resolve-studio-terminal keeps stable mac term names and normalizes case", () => {
  assert.equal(resolveStudioTerminal("darwin", "XTERM"), "xterm");
  assert.equal(resolveStudioTerminal("darwin", "tmux-256color"), "tmux-256color");
});

test("resolve-studio-terminal falls back on mac for unsupported or problematic terms", () => {
  assert.equal(resolveStudioTerminal("darwin", "xterm-256color"), "xterm");
  assert.equal(resolveStudioTerminal("darwin", "xterm-kitty"), "xterm");
  assert.equal(resolveStudioTerminal("darwin", "xterm-ghostty"), "xterm");
});

test("resolve-studio-terminal keeps non-mac term names unchanged", () => {
  assert.equal(resolveStudioTerminal("linux", "xterm-kitty"), "xterm-kitty");
});

function createPackState(options: {
  packPresent: boolean;
  trackerReadable: boolean;
  nextRecommended?: string | null;
  mode?: PlanningPackState["mode"];
  packMode?: PlanningPackState["packMode"];
  readinessReadyToWrite?: boolean;
  humanWriteConfirmed?: boolean;
}): PlanningPackState {
  return {
    planId: "default",
    packDir: ".srgical",
    packPresent: options.packPresent,
    trackerReadable: options.trackerReadable,
    docsPresent: options.packPresent ? 5 : 0,
    currentPosition: {
      lastCompleted: options.packPresent ? "DOC002" : null,
      nextRecommended: options.nextRecommended ?? null,
      updatedAt: "2026-03-25T00:00:00.000Z"
    },
    nextStepSummary: options.nextRecommended
      ? {
          id: options.nextRecommended,
          status: "pending",
          dependsOn: "DOC002",
          scope: "Ship the next slice.",
          acceptance: "It lands cleanly.",
          notes: "",
          phase: "Phase 6"
        }
      : null,
    lastExecution: null,
    planningState: null,
    packMode: options.packMode ?? (options.packPresent ? "authored" : "scaffolded"),
    readiness: {
      checks: [],
      score: options.packPresent ? 3 : 0,
      total: 4,
      readyToWrite: options.readinessReadyToWrite ?? false,
      missingLabels: []
    },
    humanWriteConfirmed: options.humanWriteConfirmed ?? false,
    humanWriteConfirmedAt: null,
    autoRun: null,
    executionActivated: Boolean(options.nextRecommended),
    mode: options.mode ?? (options.packPresent ? "Plan Written - Needs Step" : "No Pack"),
    hasFailureOverlay: false
  };
}
