import path from "node:path";
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import blessed from "blessed";
import type { PlanningAdviceState } from "../core/advice-state";
import { executeAutoRun, requestAutoRunStop } from "../core/auto-run";
import {
  getPrimaryAgentAdapter,
  getSupportedAgentAdapters,
  requestPlannerReply,
  resolvePrimaryAgent,
  runNextPrompt,
  selectPrimaryAgent,
  writePlanningPack,
  type AgentStatus
} from "../core/agent";
import {
  formatExecutionFailureMessage,
  formatNoQueuedNextStepMessage,
  hasQueuedNextStep,
  renderDryRunPreview
} from "../core/execution-controls";
import { appendExecutionLog, saveExecutionState } from "../core/execution-state";
import { buildExecutionIterationPrompt } from "../core/handoff";
import { refreshPlanningAdvice } from "../core/planning-advice";
import { readPlanningPackState, type PlanningCurrentPosition, type PlanningPackState } from "../core/planning-pack-state";
import { markPlanningPackAuthored, savePlanningState, setHumanWriteConfirmation } from "../core/planning-state";
import {
  buildBlockedStepResolutionDirective,
  buildPlanInterrogationDirective,
  type PlanInterrogationCommand
} from "../core/plan-interrogation";
import { applyPlanningPackDocumentState } from "../core/planning-doc-state";
import type { ChatMessage } from "../core/prompts";
import { loadStudioOperateConfig, type StudioOperateConfig } from "../core/studio-operate-config";
import { unblockTrackerStep } from "../core/tracker-unblock";
import { DEFAULT_STUDIO_MESSAGES, loadStoredActiveAgentId, loadStudioSession, saveStudioSession } from "../core/studio-session";
import { getInitialTemplates } from "../core/templates";
import {
  ensurePlanningDir,
  clearPlanningPackRuntimeState,
  getPlanningPackPaths,
  listPlanningDirectories,
  normalizePlanId,
  readText,
  resolvePlanId,
  resolveWorkspace,
  saveActivePlanId,
  writeText,
  type PlanningPackPaths
} from "../core/workspace";

export type StudioMode = "plan" | "operate";

type StudioOptions = {
  workspace?: string;
  planId?: string | null;
  mode?: StudioMode;
};

type BusyMode = "planner" | "pack" | "run" | "auto";
type CompletionDirection = 1 | -1;
type CommandHistoryDirection = 1 | -1;

type ComposerCompletionState = {
  seedValue: string;
  replaceStart: number;
  replaceEnd: number;
  matches: string[];
  index: number;
};

export type ComposerPathCompletionRequest = {
  command: "/read" | "/open" | "/workspace" | "/plan";
  token: string;
  replaceStart: number;
  replaceEnd: number;
};

export type ReadCommandParseResult = {
  requestedPath: string;
  trailingPrompt: string | null;
};

export type OpenCommandParseResult = {
  target: string;
  trailingPrompt: string | null;
};

export type ReadTargetFiles = {
  files: string[];
  directoryLabel: string | null;
};

export type CommandHistoryCursor = {
  entries: string[];
  index: number | null;
  draft: string;
};

type ComposerCompletionKeyPress = Pick<blessed.Widgets.Events.IKeyEventArg, "name" | "shift" | "ctrl" | "meta" | "sequence" | "full">;
type ComposerEditKeyPress = Pick<blessed.Widgets.Events.IKeyEventArg, "name" | "ctrl" | "meta" | "full" | "sequence">;

export type AgentSelectionCommand =
  | { kind: "status" }
  | { kind: "usage" }
  | { kind: "select"; requestedId: string };

type PlanInterrogationRequest = {
  command: PlanInterrogationCommand;
  focusText: string;
  label: string;
};

type UnblockCommandRequest =
  | {
      mode: "retry";
      requestedStepId: string | null;
      reason: string | null;
    }
  | {
      mode: "analyze";
      focusText: string;
    }
  | {
      mode: "usage";
    };

type TranscriptScrollProfile = {
  footerHint: string;
  helpLine: string;
  pageUpKeys: string[];
  pageDownKeys: string[];
};

type CopyCommandMode = "visible" | "all" | "last";

const TRANSCRIPT_PAGE_UP_KEYS = ["pageup", "ppage", "C-u"];
const TRANSCRIPT_PAGE_DOWN_KEYS = ["pagedown", "npage", "C-d"];
const ACTIVITY_FRAMES = ["[    ]", "[=   ]", "[==  ]", "[=== ]", "[ ===]", "[  ==]", "[   =]"];
const COMPOSER_CURSOR = "{#ffb14a-fg}\u2588{/}";
const CONTEXT_FILE_CHAR_LIMIT = 120_000;
const COMPLETION_HINT_TTL_MS = 2500;
const LIVE_STREAM_REVEAL_INTERVAL_MS = 16;
const LIVE_STREAM_REVEAL_CHARS = 40;
const RAPID_INPUT_INTERVAL_MS = 25;
const PASTE_ENTER_GRACE_MS = 45;
const PASTE_BURST_CHAR_THRESHOLD = 4;
const ESC_META_GRACE_MS = 140;
const COMMAND_HISTORY_LIMIT = 200;
const DEFAULT_OPERATE_GO_MAX_STEPS = 200;
const OPEN_TARGET_ALIASES = ["all", "plan", "context", "tracker", "handoff", "prompt", "dir"] as const;
const STUDIO_TERMINAL_FALLBACK = "xterm";
const SAFE_MAC_STUDIO_TERMINALS = new Set(["xterm", "screen", "screen-256color", "tmux", "tmux-256color"]);
const escapeBlessedText = (blessed as typeof blessed & { helpers: { escape(text: string): string } }).helpers.escape;

export async function launchStudio(options: StudioOptions = {}): Promise<void> {
  const studioMode = options.mode === "operate" ? "operate" : "plan";
  let workspace = resolveWorkspace(options.workspace);
  let planId = await resolvePlanId(workspace, options.planId);
  await saveActivePlanId(workspace, planId);
  let historyMessages = await loadStudioSession(workspace, { planId });
  let transcriptStartIndex = 0;
  const transcriptScrollProfile = resolveTranscriptScrollProfile();
  const readyFooter = buildReadyFooter(transcriptScrollProfile.footerHint, studioMode);
  const terminal = resolveStudioTerminal();
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    terminal,
    title: studioMode === "plan" ? "srgical studio plan" : "srgical studio operate"
  });

  const header = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    style: {
      fg: "#fff8ef",
      bg: "#1b1a1f"
    },
    content: buildStudioHeaderContent(workspace, null)
  });

  const transcript = blessed.box({
    top: 3,
    left: 0,
    width: "72%",
    height: "100%-10",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    padding: {
      top: 1,
      right: 2,
      bottom: 1,
      left: 2
    },
    border: {
      type: "line"
    },
    label: " Transcript ",
    style: {
      fg: "#f7efe6",
      bg: "#141318",
      border: {
        fg: "#ff7a59"
      },
      scrollbar: {
        bg: "#ff7a59"
      }
    }
  });

  const sidebar = blessed.box({
    top: 3,
    left: "72%",
    width: "28%",
    height: "100%-10",
    tags: true,
    padding: {
      top: 1,
      right: 1,
      bottom: 1,
      left: 1
    },
    border: {
      type: "line"
    },
    label: studioMode === "plan" ? " Control Room (Plan) " : " Control Room (Operate) ",
    style: {
      fg: "#d9fff8",
      bg: "#11161c",
      border: {
        fg: "#4de2c5"
      }
    }
  });

  const input = blessed.box({
    bottom: 1,
    left: 0,
    width: "100%",
    height: 6,
    keys: true,
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    padding: {
      top: 0,
      right: 1,
      bottom: 0,
      left: 1
    },
    border: {
      type: "line"
    },
    label: " Message / Command ",
    style: {
      fg: "#fff8ef",
      bg: "#1a1112",
      border: {
        fg: "#ffb14a"
      }
    }
  });

  const footer = blessed.box({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: {
      fg: "#bfb8c7",
      bg: "#1b1a1f"
    },
    content: readyFooter
  });

  screen.append(header);
  screen.append(transcript);
  screen.append(sidebar);
  screen.append(input);
  screen.append(footer);
  screen.on("render", () => {
    screen.program.hideCursor();
  });

  let busy = false;
  let busyMode: BusyMode | null = null;
  let busyStartedAt: number | null = null;
  let activityFrameIndex = 0;
  let activityTimer: NodeJS.Timeout | undefined;
  let latestPackState: PlanningPackState | null = null;
  let agentSummary = "checking...";
  let planningPackSummary = "not checked";
  let trackerSummary = "loading...";
  let executionSummary = "never run";
  let autoSummary = "idle";
  let adviceSummary = studioMode === "plan" ? "run /advice for AI guidance" : "available in studio plan mode";
  let composerValue = "";
  let commandHistoryEntries: string[] = [];
  let commandHistoryIndex: number | null = null;
  let commandHistoryDraft = "";
  let completionState: ComposerCompletionState | null = null;
  let completionHint: { text: string; expiresAt: number } | null = null;
  let lastComposerInputAt: number | null = null;
  let rapidComposerInputChars = 0;
  let lastStandaloneEscapeAt: number | null = null;
  let liveStreamLabel: string | null = null;
  let liveStreamContent = "";
  let liveStreamPendingContent = "";
  let liveStreamStopRequested = false;
  let liveStreamRenderTimer: NodeJS.Timeout | undefined;
  let studioClosed = false;

  function setSidebar(status?: string): void {
    const planningPaths = getPlanningPackPaths(workspace, { planId });

    sidebar.setContent(
      [
        "{bold}Workspace{/bold}",
        `root: ${workspace}`,
        `plan: ${planId}`,
        `plan dir: ${planningPaths.relativeDir}`,
        `mode: ${studioMode}`,
        "",
        "{bold}Agent{/bold}",
        agentSummary,
        "",
        "{bold}Planning Pack{/bold}",
        planningPackSummary,
        "",
        "{bold}Tracker{/bold}",
        trackerSummary,
        "",
        "{bold}Last Run{/bold}",
        executionSummary,
        "",
        "{bold}Auto{/bold}",
        autoSummary,
        "",
        "{bold}Advice{/bold}",
        adviceSummary,
        "",
        "{bold}State{/bold}",
        status ?? getActivityState()
      ].join("\n")
    );
  }

  function setFooter(status?: string): void {
    footer.setContent(status ?? getFooterContent());
  }

  function getActivityState(): string {
    if (!busy || !busyMode || busyStartedAt === null) {
      return "ready";
    }

    return `${getActivityFrame()} ${describeBusyMode(busyMode)} (${formatElapsed(Date.now() - busyStartedAt)})`;
  }

  function getFooterContent(): string {
    if (!busy || !busyMode || busyStartedAt === null) {
      if (completionHint && completionHint.expiresAt <= Date.now()) {
        completionHint = null;
      }

      if (completionHint && completionHint.expiresAt > Date.now()) {
        return ` ${completionHint.text} `;
      }

      if (composerValue.includes("\n")) {
        const lineCount = composerValue.split("\n").length;
        return ` Draft: ${lineCount} lines (${composerValue.length} chars)   Enter send   Shift+Enter newline `;
      }

      return readyFooter;
    }

    return ` ${getActivityFrame()} ${describeBusyMode(busyMode)}   elapsed ${formatElapsed(Date.now() - busyStartedAt)}   planner and agent calls can take a moment `;
  }

  function getActivityFrame(): string {
    return ACTIVITY_FRAMES[activityFrameIndex % ACTIVITY_FRAMES.length];
  }

  function startBusy(mode: BusyMode, status?: string): void {
    busy = true;
    busyMode = mode;
    busyStartedAt = Date.now();
    activityFrameIndex = 0;
    stopActivityTimer();
    setSidebar(status);
    setFooter(status);
    screen.render();

    activityTimer = setInterval(() => {
      activityFrameIndex += 1;
      setSidebar(status);
      setFooter(status);
      screen.render();
    }, 1000);
  }

  function stopBusy(): void {
    busy = false;
    busyMode = null;
    busyStartedAt = null;
    activityFrameIndex = 0;
    stopActivityTimer();
  }

  function stopActivityTimer(): void {
    if (activityTimer) {
      clearInterval(activityTimer);
      activityTimer = undefined;
    }
  }

  function closeStudio(): void {
    if (studioClosed) {
      return;
    }

    studioClosed = true;
    resetLiveStream();
    stopBusy();

    screen.destroy();
  }

  function startLiveStream(label: string): void {
    liveStreamLabel = label;
    liveStreamContent = "";
    liveStreamPendingContent = "";
    liveStreamStopRequested = false;
    scheduleLiveStreamRender();
  }

  function appendLiveStreamChunk(chunk: string): void {
    if (!liveStreamLabel) {
      return;
    }

    const sanitizedChunk = sanitizeModelOutputChunk(chunk);
    if (!sanitizedChunk) {
      return;
    }

    liveStreamPendingContent += sanitizedChunk;
    scheduleLiveStreamRender();
  }

  async function stopLiveStream(): Promise<void> {
    if (!liveStreamLabel) {
      resetLiveStream();
      return;
    }

    liveStreamStopRequested = true;

    if (liveStreamPendingContent.length > 0) {
      await drainLiveStream();
    }

    resetLiveStream();
  }

  function resetLiveStream(): void {
    liveStreamLabel = null;
    liveStreamContent = "";
    liveStreamPendingContent = "";
    liveStreamStopRequested = false;
    if (liveStreamRenderTimer) {
      clearTimeout(liveStreamRenderTimer);
      liveStreamRenderTimer = undefined;
    }
    renderTranscript();
    setFooter();
    screen.render();
  }

  function scheduleLiveStreamRender(): void {
    if (liveStreamRenderTimer) {
      return;
    }

    liveStreamRenderTimer = setTimeout(() => {
      liveStreamRenderTimer = undefined;
      revealLiveStreamChunk();
      renderTranscript();
      setFooter();
      screen.render();
      if (liveStreamPendingContent.length > 0 || (liveStreamStopRequested && liveStreamLabel)) {
        scheduleLiveStreamRender();
      }
    }, LIVE_STREAM_REVEAL_INTERVAL_MS);
  }

  async function drainLiveStream(): Promise<void> {
    while (liveStreamPendingContent.length > 0 && !studioClosed) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, LIVE_STREAM_REVEAL_INTERVAL_MS);
      });
    }
  }

  function revealLiveStreamChunk(): void {
    if (!liveStreamLabel || liveStreamPendingContent.length === 0) {
      return;
    }

    const codePoints = Array.from(liveStreamPendingContent);
    const nextChunk = codePoints.slice(0, LIVE_STREAM_REVEAL_CHARS).join("");
    liveStreamPendingContent = codePoints.slice(LIVE_STREAM_REVEAL_CHARS).join("");
    liveStreamContent += nextChunk;
  }

  function renderTranscript(): void {
    const renderedMessages = getVisibleTranscriptMessages(historyMessages, transcriptStartIndex)
      .map((message) => {
        const tone =
          message.role === "user"
            ? "{#ffb14a-fg}YOU{/}"
            : message.role === "assistant"
              ? "{#4de2c5-fg}PLANNER{/}"
              : "{#ff7a59-fg}SYSTEM{/}";

        return `${tone}\n${escapeBlessedText(message.content)}`;
      })
      .join("\n\n");

    const liveStreamBlock =
      liveStreamLabel === null
        ? ""
        : `{#4de2c5-fg}${escapeBlessedText(liveStreamLabel)}{/}\n${escapeBlessedText(
            liveStreamContent.length > 0 ? liveStreamContent : "...waiting for model output"
          )}`;

    const rendered = [renderedMessages, liveStreamBlock].filter((block) => block.length > 0).join("\n\n");

    transcript.setContent(rendered);
    transcript.setScrollPerc(100);
  }

  function renderComposer(): void {
    const escapedValue = escapeBlessedText(composerValue);
    input.setContent(`${escapedValue}${COMPOSER_CURSOR}`);
    input.setScrollPerc(100);
  }

  function clearCompletionState(): void {
    completionState = null;
  }

  function setCompletionHint(text: string): void {
    completionHint = {
      text,
      expiresAt: Date.now() + COMPLETION_HINT_TTL_MS
    };
  }

  function clearCompletionHint(): void {
    completionHint = null;
  }

  function resetComposerInputBurst(): void {
    lastComposerInputAt = null;
    rapidComposerInputChars = 0;
  }

  function noteComposerInput(chunk: string): void {
    if (!chunk) {
      return;
    }

    const now = Date.now();
    const chunkLength = Array.from(chunk).length;

    if (chunkLength === 0) {
      return;
    }

    if (lastComposerInputAt !== null && now - lastComposerInputAt <= RAPID_INPUT_INTERVAL_MS) {
      rapidComposerInputChars += chunkLength;
    } else {
      rapidComposerInputChars = chunkLength;
    }

    lastComposerInputAt = now;
  }

  function appendComposerNewline(): void {
    resetCommandHistoryNavigation();
    clearCompletionState();
    clearCompletionHint();
    composerValue += "\n";
    noteComposerInput("\n");
    renderComposer();
    setFooter();
    screen.render();
  }

  function scrollTranscript(lines: number): void {
    transcript.scroll(lines);
    screen.render();
  }

  function resetCommandHistoryNavigation(): void {
    commandHistoryIndex = null;
    commandHistoryDraft = "";
  }

  function restoreCommandFromHistory(direction: CommandHistoryDirection): void {
    const result = navigateCommandHistory(
      {
        entries: commandHistoryEntries,
        index: commandHistoryIndex,
        draft: commandHistoryDraft
      },
      composerValue,
      direction
    );

    if (!result.changed) {
      return;
    }

    commandHistoryIndex = result.cursor.index;
    commandHistoryDraft = result.cursor.draft;
    composerValue = result.value;
    resetComposerInputBurst();
    clearCompletionState();
    clearCompletionHint();
    renderComposer();
    setFooter();
    screen.render();
  }

  async function appendMessage(message: ChatMessage): Promise<void> {
    historyMessages.push(message);
    await saveStudioSession(workspace, historyMessages, { planId });
  }

  async function appendSystemMessage(content: string): Promise<void> {
    await appendMessage({
      role: "system",
      content
    });
    renderTranscript();
    setSidebar();
    setFooter();
    screen.render();
  }

  async function submitComposer(): Promise<void> {
    const rawValue = composerValue;
    const text = rawValue.trim();

    if (!text) {
      setFooter();
      screen.render();
      return;
    }

    if (busy && text !== "/stop") {
      setCompletionHint("Studio is busy. Wait for the current task or run /stop.");
      setFooter();
      screen.render();
      return;
    }

    composerValue = "";
    resetComposerInputBurst();
    clearCompletionState();
    clearCompletionHint();
    renderComposer();

    if (text.startsWith("/")) {
      commandHistoryEntries = appendCommandHistoryEntry(commandHistoryEntries, text);
      resetCommandHistoryNavigation();
      await appendMessage({
        role: "system",
        content: `Command: ${text}`
      });
      await handleSlashCommand(text);

      if (studioClosed) {
        return;
      }

      input.focus();
      renderComposer();
      setFooter();
      screen.render();
      return;
    }

    if (studioMode === "operate") {
      await appendSystemMessage(
        "Operate mode is command-first. Use `/go`, `/run`, or `/auto` for execution, or switch to `srgical studio plan` for planning conversation."
      );
      input.focus();
      renderComposer();
      setFooter();
      screen.render();
      return;
    }

    resetCommandHistoryNavigation();
    await submitUserPrompt(text);
  }

  async function submitUserPrompt(text: string): Promise<void> {
    startBusy("planner");
    await appendMessage({
      role: "user",
      content: text
    });
    renderTranscript();
    setSidebar();
    setFooter();
    renderComposer();
    screen.render();

    startLiveStream(`${getPrimaryAgentAdapter().label.toUpperCase()} STREAM`);

    try {
      const reply = await requestPlannerReply(workspace, historyMessages, {
        planId,
        onOutputChunk: appendLiveStreamChunk
      });
      await stopLiveStream();
      await appendMessage({
        role: "assistant",
        content: reply
      });
      await refreshAdvice(false);
    } catch (error) {
      await stopLiveStream();
      await appendMessage({
        role: "system",
        content: `Planner call failed: ${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      await stopLiveStream();
      stopBusy();
      renderTranscript();
      setSidebar();
      setFooter();
      renderComposer();
      setFooter();
      input.focus();
      screen.render();
    }
  }

  async function refreshEnvironment(): Promise<void> {
    const [storedAgentId, packState] = await Promise.all([
      loadStoredActiveAgentId(workspace, { planId }),
      readPlanningPackState(workspace, { planId })
    ]);
    let agentState = await resolvePrimaryAgent(workspace, { planId });

    if (!storedAgentId) {
      const availableAgents = agentState.statuses.filter((status) => status.available);

      if (availableAgents.length === 1) {
        agentState = await selectPrimaryAgent(workspace, availableAgents[0].id, { planId });
      }
    }

    latestPackState = packState;
    header.setContent(buildStudioHeaderContent(workspace, packState));
    agentSummary = formatAgentSummary(agentState.status, agentState.statuses);
    planningPackSummary = formatPlanningPackSummary(workspace, packState);
    trackerSummary = formatTrackerSummary(packState.currentPosition);
    executionSummary = formatExecutionSummary(packState.lastExecution);
    autoSummary = formatAutoSummary(packState);
    adviceSummary = formatAdviceSummary(packState.advice, studioMode);
    setSidebar();
    setFooter();
    renderTranscript();
    renderComposer();
    screen.render();
  }

  async function switchPlan(nextPlanId: string): Promise<void> {
    planId = normalizePlanId(nextPlanId);
    await saveActivePlanId(workspace, planId);
    historyMessages = await loadStudioSession(workspace, { planId });
    transcriptStartIndex = 0;
    await refreshEnvironment();
  }

  async function refreshAdvice(showInTranscript = false): Promise<void> {
    try {
      const advice = await refreshPlanningAdvice(workspace, historyMessages, { planId });
      await refreshEnvironment();

      if (showInTranscript) {
        await appendSystemMessage(renderAdviceMessage(advice));
      }
    } catch (error) {
      if (showInTranscript) {
        await appendSystemMessage(`Advice refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async function runPlanInterrogation(
    command: PlanInterrogationCommand,
    focusText: string,
    label: string
  ): Promise<void> {
    startBusy("planner", `running /${command}...`);
    startLiveStream(`${getPrimaryAgentAdapter().label.toUpperCase()} ${label.toUpperCase()} STREAM`);

    try {
      const directive = await buildPlanInterrogationDirective(workspace, command, focusText, { planId });
      const interrogationMessages: ChatMessage[] = [
        ...historyMessages,
        {
          role: "system",
          content: directive
        }
      ];
      const reply = await requestPlannerReply(workspace, interrogationMessages, {
        planId,
        onOutputChunk: appendLiveStreamChunk
      });
      await stopLiveStream();
      await appendSystemMessage(`/${command}${focusText ? ` ${focusText}` : ""}\n${reply}`);
      await refreshAdvice(false);
    } catch (error) {
      await stopLiveStream();
      await appendSystemMessage(`/${command} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await stopLiveStream();
      stopBusy();
      await refreshEnvironment();
    }
  }

  async function runBlockedStepResolution(focusText: string): Promise<void> {
    const packState = await readPlanningPackState(workspace, { planId });
    const blockedStep =
      packState.nextStepSummary && packState.nextStepSummary.status.trim().toLowerCase() === "blocked"
        ? packState.nextStepSummary
        : null;

    if (!blockedStep) {
      await appendSystemMessage(
        "No blocked next step is active right now. Use `/unblock <STEP_ID>` for a specific blocked row, or `/review` to inspect the tracker."
      );
      return;
    }

    startBusy("planner", "running /unblock analyze...");
    startLiveStream(`${getPrimaryAgentAdapter().label.toUpperCase()} UNBLOCK STREAM`);

    try {
      const directive = await buildBlockedStepResolutionDirective(
        workspace,
        blockedStep.id,
        blockedStep.notes,
        focusText,
        { planId }
      );
      const interrogationMessages: ChatMessage[] = [
        ...historyMessages,
        {
          role: "system",
          content: directive
        }
      ];
      const reply = await requestPlannerReply(workspace, interrogationMessages, {
        planId,
        onOutputChunk: appendLiveStreamChunk
      });
      await stopLiveStream();
      await appendSystemMessage(`/unblock analyze${focusText ? ` ${focusText}` : ""}\n${reply}`);
      await refreshAdvice(false);
    } catch (error) {
      await stopLiveStream();
      await appendSystemMessage(`/unblock analyze failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await stopLiveStream();
      stopBusy();
      await refreshEnvironment();
    }
  }

  async function runUnblockRetry(request: Extract<UnblockCommandRequest, { mode: "retry" }>): Promise<void> {
    startBusy("run", "applying /unblock retry...");

    try {
      const result = await unblockTrackerStep(workspace, {
        planId,
        requestedStepId: request.requestedStepId,
        reason: request.reason ?? undefined
      });
      const trackerRelative = normalizePathSeparators(path.relative(workspace, result.trackerPath), false) || result.trackerPath;
      const previousNext = result.nextRecommendedBefore ? `\`${result.nextRecommendedBefore}\`` : "none queued";

      await appendSystemMessage(
        [
          `Unblock retry staged for \`${result.stepId}\`.`,
          `Status: \`${result.previousStatus}\` -> \`pending\`.`,
          `Next Recommended: ${previousNext} -> \`${result.nextRecommendedAfter}\`.`,
          `Tracker updated: \`${trackerRelative}\`.`,
          request.reason ? `Reason logged: ${request.reason}` : "Reason logged: unblock retry requested.",
          "Run `/go` to continue execution. Use `/unblock analyze [focus]` if you want root-cause guidance first."
        ].join("\n")
      );
    } catch (error) {
      await appendSystemMessage(
        [
          `/unblock retry failed: ${error instanceof Error ? error.message : String(error)}`,
          "Use `/review` to inspect the tracker, then rerun `/unblock` with a step ID if needed.",
          "Use `/unblock analyze [focus]` for blocker-resolution guidance."
        ].join("\n")
      );
    } finally {
      stopBusy();
      await refreshEnvironment();
    }
  }

  async function handleSlashCommand(command: string): Promise<void> {
    if (command === "/quit") {
      closeStudio();
      return;
    }

    if (command === "/clear") {
      const visibleMessageCount = getVisibleTranscriptMessages(historyMessages, transcriptStartIndex).length;
      transcriptStartIndex = historyMessages.length;
      await appendSystemMessage(
        visibleMessageCount > 0
          ? `Transcript cleared (${visibleMessageCount} message${visibleMessageCount === 1 ? "" : "s"} hidden). History is preserved; run \`/history\` to show it again.`
          : "Transcript already clear. History is preserved; run `/history` to show it again."
      );
      return;
    }

    if (command === "/history") {
      const wasCleared = clampTranscriptStartIndex(transcriptStartIndex, historyMessages.length) > 0;
      transcriptStartIndex = 0;
      await appendSystemMessage(
        wasCleared
          ? `Transcript history restored (${historyMessages.length} message${historyMessages.length === 1 ? "" : "s"} visible).`
          : "Transcript already showing full history."
      );
      return;
    }

    if (studioMode === "plan" && isOperateOnlyCommand(command)) {
      await appendSystemMessage(
        "This is `studio plan`. Execution commands are disabled here. Open `srgical studio operate --plan <id>` (or `sso`) to run delivery automation."
      );
      return;
    }

    if (studioMode === "operate" && isPlanOnlyCommand(command)) {
      await appendSystemMessage(
        "This is `studio operate`. Planning commands are disabled here. Open `srgical studio plan --plan <id>` (or `ssp`) to refine the plan."
      );
      return;
    }

    if (command === "/workspace") {
      const packState = latestPackState ?? (await readPlanningPackState(workspace, { planId }));
      await appendSystemMessage(renderWorkspaceSelectionMessage(workspace, packState));
      return;
    }

    if (command.startsWith("/workspace")) {
      const workspaceCommand = await parseReadCommandInput(workspace, command.slice("/workspace".length));
      const requestedWorkspace = workspaceCommand.requestedPath.trim();

      if (!requestedWorkspace) {
        const packState = latestPackState ?? (await readPlanningPackState(workspace, { planId }));
        await appendSystemMessage(renderWorkspaceSelectionMessage(workspace, packState));
        return;
      }

      const nextWorkspace = resolveStudioWorkspaceInput(workspace, requestedWorkspace);

      setSidebar("switching workspace...");
      setFooter(" Switching workspace... ");
      screen.render();

      const previousWorkspace = workspace;
      const previousPlanId = planId;

      try {
        workspace = nextWorkspace;
        planId = await resolvePlanId(workspace, previousPlanId);
        await saveActivePlanId(workspace, planId);
        historyMessages = await loadStudioSession(workspace, { planId });
        transcriptStartIndex = 0;
        await refreshEnvironment();
        await appendSystemMessage(
          [
            `Now looking at ${workspace}.`,
            "",
            renderWorkspaceSelectionMessage(workspace, latestPackState ?? (await readPlanningPackState(workspace, { planId })))
          ].join("\n")
        );

        if (workspaceCommand.trailingPrompt) {
          if (studioMode === "operate") {
            await appendSystemMessage(
              `Ignored trailing text after /workspace switch in operate mode: \`${workspaceCommand.trailingPrompt}\`.`
            );
          } else {
            await submitUserPrompt(workspaceCommand.trailingPrompt);
          }
        }
      } catch (error) {
        workspace = previousWorkspace;
        planId = previousPlanId;
        await refreshEnvironment();
        await appendSystemMessage(
          [
            `Workspace switch blocked: ${error instanceof Error ? error.message : String(error)}`,
            "Use `/workspace <path>` after creating or selecting a named plan in that repo.",
            workspaceCommand.trailingPrompt
              ? `Trailing follow-up was not sent because the workspace switch failed: \`${workspaceCommand.trailingPrompt}\`.`
              : ""
          ]
            .filter((line) => line.length > 0)
            .join("\n")
        );
      }
      return;
    }

    if (command === "/plans") {
      await appendSystemMessage(await renderPlansMessage(workspace, planId));
      return;
    }

    if (command === "/plan") {
      await appendSystemMessage(renderPlanUsageMessage(planId, getPlanningPackPaths(workspace, { planId })));
      return;
    }

    if (command.startsWith("/plan new ")) {
      const requestedPlanId = command.slice("/plan new ".length).trim();

      if (!requestedPlanId) {
        await appendSystemMessage("Usage: `/plan new <id>`");
        return;
      }

      setSidebar("creating named plan...");
      setFooter(" Creating named plan... ");
      screen.render();

      const createdPaths = await createPlanScaffold(workspace, requestedPlanId);
      await switchPlan(createdPaths.planId);
      await appendSystemMessage(
        [
          `Created and selected plan \`${createdPaths.planId}\`.`,
          `Planning directory: ${createdPaths.relativeDir}`,
          "Use `/readiness` while gathering context, then `/write` to generate the first grounded draft."
        ].join("\n")
      );
      return;
    }

    if (command.startsWith("/plan ")) {
      const requestedPlanId = command.slice("/plan ".length).trim();

      if (!requestedPlanId) {
        await appendSystemMessage(renderPlanUsageMessage(planId, getPlanningPackPaths(workspace, { planId })));
        return;
      }

      await switchPlan(requestedPlanId);
      await appendSystemMessage(`Active plan set to \`${planId}\`.\nPlanning directory: ${getPlanningPackPaths(workspace, { planId }).relativeDir}`);
      return;
    }

    if (command === "/status") {
      const packState = latestPackState ?? (await readPlanningPackState(workspace, { planId }));
      await appendSystemMessage(renderStatusMessage(workspace, packState));
      return;
    }

    if (command === "/readiness") {
      const packState = latestPackState ?? (await readPlanningPackState(workspace, { planId }));
      await appendSystemMessage(renderReadinessMessage(packState));
      return;
    }

    if (command === "/review") {
      const packState = latestPackState ?? (await readPlanningPackState(workspace, { planId }));
      const paths = getPlanningPackPaths(workspace, { planId });
      await appendSystemMessage(
        [
          `Human review checklist for plan \`${planId}\`:`,
          `- ${paths.plan}`,
          `- ${paths.context}`,
          `- ${paths.tracker}`,
          `- ${paths.handoff}`,
          `- ${paths.nextPrompt}`,
          "",
          packState.humanWriteConfirmed
            ? `Human write confirmation: confirmed (${packState.humanWriteConfirmedAt ?? "timestamp unavailable"})`
            : "Human write confirmation: pending",
          "Run `/open all` to open every planning doc in VS Code.",
          packState.packMode === "scaffolded"
            ? "This plan is still scaffolded; run `/write` to generate the first grounded draft from the transcript."
            : "Run `/confirm-plan` after human review is complete, then `/write` to refresh the authored plan."
        ].join("\n")
      );
      return;
    }

    if (command === "/read" || command.startsWith("/read ")) {
      const readCommand =
        command === "/read"
          ? {
              requestedPath: ".",
              trailingPrompt: null
            }
          : await parseReadCommandInput(workspace, command.slice("/read".length));
      const requestedPath = stripWrappingQuotes(readCommand.requestedPath || ".");

      if (!requestedPath) {
        await appendSystemMessage("Usage: `/read [path]` (no path defaults to current directory, non-recursive).");
        return;
      }

      try {
        const targets = await collectReadTargetFiles(workspace, requestedPath);

        if (targets.directoryLabel) {
          await appendSystemMessage(`Reading ${targets.files.length} file(s) from \`${targets.directoryLabel}\` (non-recursive).`);
        }

        for (const targetPath of targets.files) {
          const contextMessage = await loadFileContextMessage(workspace, targetPath);
          await appendSystemMessage(contextMessage);
        }

        if (readCommand.trailingPrompt) {
          await submitUserPrompt(readCommand.trailingPrompt);
        }
      } catch (error) {
        await appendSystemMessage(
          [
            `Could not read file: ${error instanceof Error ? error.message : String(error)}`,
            readCommand.trailingPrompt
              ? `Tip: \`/read\` accepts only a file path. I treated \`${requestedPath}\` as the path and did not run follow-up text \`${readCommand.trailingPrompt}\` because the file load failed.`
              : "Tip: use `/read [path]` (or `/read` for current directory) and ask questions in a separate message."
          ].join("\n")
        );
      }
      return;
    }

    if (command.startsWith("/open")) {
      const openCommand = await parseOpenCommandInput(workspace, command.slice("/open".length));
      const target = openCommand.target;
      const paths = getPlanningPackPaths(workspace, { planId });
      const openTargets = resolveOpenTargets(workspace, paths, target);

      if (openTargets.length === 0) {
        await appendSystemMessage(
          "Usage: `/open [all|plan|context|tracker|handoff|prompt|dir|<path>]`"
        );
        return;
      }

      const openResult = await openInVsCode(openTargets);
      await appendSystemMessage(
        openResult.ok
          ? `Opened ${openTargets.length === 1 ? "target" : "targets"} in VS Code:\n${openTargets.join("\n")}`
          : [
              `Could not launch VS Code automatically: ${openResult.reason}`,
              "Open manually with:",
              `code ${openTargets.map((targetPath) => `"${targetPath}"`).join(" ")}`
            ].join("\n")
      );

      if (openCommand.trailingPrompt) {
        await appendSystemMessage(
          `Ignored trailing text after /open target: \`${openCommand.trailingPrompt}\`.\nSend that as a normal message if you want to ask a follow-up question.`
        );
      }
      return;
    }

    if (command === "/confirm-plan") {
      const packState = latestPackState ?? (await readPlanningPackState(workspace, { planId }));

      if (!packState.packPresent) {
        await appendSystemMessage("No planning pack is present for this plan yet. Run `/plan new <id>` first.");
        return;
      }

      await setHumanWriteConfirmation(workspace, true, { planId });
      await refreshEnvironment();
      await appendSystemMessage(
        packState.packMode === "scaffolded"
          ? "Human write confirmation recorded. This approval will be enforced after the first authored draft is generated."
          : "Human write confirmation recorded. `/write` is now allowed once readiness is satisfied."
      );
      return;
    }

    if (command === "/revoke-plan-confirmation") {
      const packState = latestPackState ?? (await readPlanningPackState(workspace, { planId }));
      await setHumanWriteConfirmation(workspace, false, { planId });
      await refreshEnvironment();
      await appendSystemMessage(
        requiresHumanWriteConfirmation(packState)
          ? "Human write confirmation revoked. `/write` is now blocked until `/confirm-plan` is run again."
          : "Human write confirmation revoked. First scaffolded `/write` remains allowed; authored-plan refresh writes will require `/confirm-plan`."
      );
      return;
    }

    if (command === "/advice") {
      startBusy("planner", "refreshing AI advice...");

      try {
        await refreshAdvice(true);
      } finally {
        stopBusy();
        await refreshEnvironment();
      }

      return;
    }

    const interrogationRequest = parsePlanInterrogationCommand(command);
    if (interrogationRequest) {
      await runPlanInterrogation(interrogationRequest.command, interrogationRequest.focusText, interrogationRequest.label);
      return;
    }

    if (command === "/unblock" || command.startsWith("/unblock ")) {
      if (studioMode !== "operate") {
        await appendSystemMessage("`/unblock` is available only in `studio operate`.");
        return;
      }

      const unblockCommand = parseUnblockCommand(command);

      if (unblockCommand.mode === "usage") {
        await appendSystemMessage(renderUnblockUsageMessage());
        return;
      }

      if (unblockCommand.mode === "analyze") {
        await runBlockedStepResolution(unblockCommand.focusText);
        return;
      }

      await runUnblockRetry(unblockCommand);
      return;
    }

    if (command === "/stop") {
      const state = await requestAutoRunStop(workspace, { planId });
      await refreshEnvironment();
      await appendSystemMessage(
        state.status === "stop_requested"
          ? "Stop requested. Auto mode will finish the current iteration before stopping."
          : "No active auto run was in progress."
      );
      return;
    }

    const agentCommand = parseAgentSelectionCommand(command);
    if (agentCommand) {
      if (agentCommand.kind === "status" || agentCommand.kind === "usage") {
        const agentState = await resolvePrimaryAgent(workspace, { planId });
        await appendSystemMessage(
          agentCommand.kind === "usage"
            ? [buildAgentUsageMessage(), "", renderAgentSelectionMessage(agentState.status, agentState.statuses)].join("\n")
            : renderAgentSelectionMessage(agentState.status, agentState.statuses)
        );
        return;
      }

      setSidebar("updating active agent...");
      setFooter(" Updating active agent selection... ");
      screen.render();

      try {
        const agentState = await selectPrimaryAgent(workspace, agentCommand.requestedId, { planId });
        await appendSystemMessage(
          [`Active agent set to ${agentState.status.label} for plan \`${planId}\`.`, "", renderAgentSelectionMessage(agentState.status, agentState.statuses)].join(
            "\n"
          )
        );
      } catch (error) {
        await appendSystemMessage(`Agent selection failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await refreshEnvironment();
      }

      return;
    }

    const copyCommand = parseCopyCommand(command);
    if (copyCommand) {
      const transcriptText = buildTranscriptCopyText(historyMessages, transcriptStartIndex, copyCommand);

      try {
        await copyTextToClipboard(transcriptText);
        await appendSystemMessage(
          copyCommand === "last"
            ? "Copied the last visible transcript message to the clipboard."
            : copyCommand === "all"
              ? "Copied the full transcript history to the clipboard."
              : "Copied the visible transcript to the clipboard."
        );
      } catch (error) {
        await appendSystemMessage(
          [
            "Clipboard copy failed from the terminal UI.",
            "Some terminals make alternate-screen selection unreliable, so `/copy` uses the OS clipboard directly when available.",
            `Reason: ${error instanceof Error ? error.message : String(error)}`
          ].join("\n")
        );
      }

      return;
    }

    if (command === "/help") {
      await appendSystemMessage(
        studioMode === "plan"
          ? renderPlanHelpMessage(transcriptScrollProfile.helpLine)
          : renderOperateHelpMessage(transcriptScrollProfile.helpLine)
      );
      return;
    }

    if (command === "/go" || command.startsWith("/go ")) {
      if (studioMode !== "operate") {
        await appendSystemMessage("`/go` is available only in `studio operate`.");
        return;
      }

      const requestedMaxSteps = parseRequestedMaxSteps(command.slice("/go".length).trim());
      if (requestedMaxSteps === null) {
        await appendSystemMessage("Usage: `/go [max]` where `max` is a positive integer.");
        return;
      }

      const operateConfig = await loadStudioOperateConfig(workspace, { planId });

      if (operateConfig.pauseForPr) {
        await handleSlashCommand("/run");
        const refreshed = await readPlanningPackState(workspace, { planId });

        if (refreshed.lastExecution?.status === "success" && hasQueuedNextStep(refreshed.currentPosition.nextRecommended)) {
          await appendSystemMessage(renderPauseForPrMessage(operateConfig));
        } else if (refreshed.lastExecution?.status === "success" && !hasQueuedNextStep(refreshed.currentPosition.nextRecommended)) {
          await appendSystemMessage("Operate flow complete. No next recommended step remains.");
        }
        return;
      }

      const maxSteps = requestedMaxSteps ?? DEFAULT_OPERATE_GO_MAX_STEPS;
      await handleSlashCommand(`/auto ${maxSteps}`);
      return;
    }

    if (command === "/preview") {
      const packState = await readPlanningPackState(workspace, { planId });

      if (!packState.packPresent) {
        await appendSystemMessage("Execution preview unavailable: no planning pack was found for the selected plan yet.");
        return;
      }

      const handoffPrompt = await buildExecutionIterationPrompt(workspace, packState, { planId });
      await appendSystemMessage(
        renderDryRunPreview(handoffPrompt.prompt, packState.nextStepSummary, packState.currentPosition.nextRecommended).join("\n")
      );
      return;
    }

    if (command === "/write") {
      const packState = latestPackState ?? (await readPlanningPackState(workspace, { planId }));

      if (!packState.readiness.readyToWrite) {
        await appendSystemMessage(
          [
            "Planning pack write blocked: readiness requirements are not fully satisfied yet.",
            "Run `/readiness` to see missing signals, then continue the planning conversation."
          ].join("\n")
        );
        return;
      }

      if (requiresHumanWriteConfirmation(packState) && !packState.humanWriteConfirmed) {
        await appendSystemMessage(
          [
            "Planning pack write blocked: explicit human confirmation is required.",
            "Run `/review` and `/open all`, then run `/confirm-plan` after approval."
          ].join("\n")
        );
        return;
      }

      startBusy("pack");
      startLiveStream(`${getPrimaryAgentAdapter().label.toUpperCase()} PACK STREAM`);

      try {
        const result = await writePlanningPack(workspace, historyMessages, {
          planId,
          onOutputChunk: appendLiveStreamChunk
        });
        await stopLiveStream();
        await applyPlanningPackDocumentState(getPlanningPackPaths(workspace, { planId }), "grounded");
        await markPlanningPackAuthored(workspace, { planId });
        await refreshAdvice(false);
        await appendSystemMessage(`Planning pack updated for \`${planId}\`. Summary:\n${result}`);
      } catch (error) {
        await stopLiveStream();
        await appendSystemMessage(`Pack generation failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await stopLiveStream();
        stopBusy();
        await refreshEnvironment();
      }

      return;
    }

    if (command === "/run") {
      const packState = await readPlanningPackState(workspace, { planId });

      if (!hasQueuedNextStep(packState.currentPosition.nextRecommended)) {
        await appendSystemMessage(formatNoQueuedNextStepMessage("studio"));
        return;
      }

      startBusy("run");
      startLiveStream(`${getPrimaryAgentAdapter().label.toUpperCase()} EXEC STREAM`);

      try {
        const handoffPrompt = await buildExecutionIterationPrompt(workspace, packState, { planId });
        const result = await runNextPrompt(workspace, handoffPrompt.prompt, {
          planId,
          onOutputChunk: appendLiveStreamChunk
        });
        await stopLiveStream();
        await saveExecutionState(workspace, "success", "studio", result, { planId });
        await appendExecutionLog(workspace, "success", "studio", result, {
          planId,
          stepLabel: packState.nextStepSummary?.id ?? packState.currentPosition.nextRecommended
        });
        await refreshAdvice(false);
        await appendSystemMessage(
          `Execution run finished. Handoff source: ${handoffPrompt.handoffDoc.displayPath}.\n${getPrimaryAgentAdapter().label} summary:\n${result}`
        );
      } catch (error) {
        await stopLiveStream();
        const message = error instanceof Error ? error.message : String(error);
        await saveExecutionState(workspace, "failure", "studio", message, { planId });
        await appendExecutionLog(workspace, "failure", "studio", message, {
          planId,
          stepLabel: packState.nextStepSummary?.id ?? packState.currentPosition.nextRecommended
        });
        const refreshedPackState = await readPlanningPackState(workspace, { planId });
        await appendSystemMessage(
          formatExecutionFailureMessage(
            message,
            refreshedPackState.nextStepSummary,
            refreshedPackState.currentPosition.nextRecommended,
            "studio"
          )
        );
      } finally {
        await stopLiveStream();
        stopBusy();
        await refreshEnvironment();
      }

      return;
    }

    if (command.startsWith("/auto")) {
      const requestedMax = command.slice("/auto".length).trim();
      const maxSteps = requestedMax ? Number(requestedMax) : undefined;

      startBusy("auto");

      try {
        const result = await executeAutoRun(workspace, {
          source: "studio",
          planId,
          maxSteps,
          onMessage: async (line) => {
            await appendSystemMessage(line);
          }
        });
        await refreshAdvice(false);
        await appendSystemMessage(`Auto mode finished: ${result.summary}`);
      } catch (error) {
        await appendSystemMessage(`Auto mode failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        stopBusy();
        await refreshEnvironment();
      }

      return;
    }

    await appendSystemMessage(`Unknown command: ${command}`);
  }

  async function cycleComposerCompletion(direction: CompletionDirection): Promise<void> {
    const existingValue = completionState ? applyCompletionState(completionState) : null;

    if (completionState && existingValue === composerValue && completionState.matches.length > 0) {
      const count = completionState.matches.length;
      const nextIndex = (completionState.index + (direction > 0 ? 1 : -1) + count) % count;
      completionState = {
        ...completionState,
        index: nextIndex
      };
      composerValue = applyCompletionState(completionState);
      setCompletionHint(
        count > 1
          ? `Path ${nextIndex + 1}/${count}: ${completionState.matches[nextIndex]} (Tab to cycle)`
          : `Path: ${completionState.matches[nextIndex]}`
      );
      renderComposer();
      setFooter();
      screen.render();
      return;
    }

    clearCompletionState();
    const request = parseComposerPathCompletionRequest(composerValue);

    if (!request) {
      setCompletionHint(
        studioMode === "plan"
          ? "Path completion works with /read, /open, and /workspace."
          : "Path completion works with /open and /workspace."
      );
      setFooter();
      screen.render();
      return;
    }

    const matches = await collectPathCompletionMatches(workspace, request);

    if (matches.length === 0) {
      setCompletionHint(`No matches for: ${request.token || "(current directory)"}`);
      setFooter();
      screen.render();
      return;
    }

    const initialIndex = direction > 0 ? 0 : matches.length - 1;
    completionState = {
      seedValue: composerValue,
      replaceStart: request.replaceStart,
      replaceEnd: request.replaceEnd,
      matches,
      index: initialIndex
    };
    composerValue = applyCompletionState(completionState);
    setCompletionHint(
      matches.length > 1
        ? `Path ${initialIndex + 1}/${matches.length}: ${matches[initialIndex]} (Tab to cycle)`
        : `Path: ${matches[initialIndex]}`
    );
    renderComposer();
    setFooter();
    screen.render();
  }

  input.on("keypress", async (ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
    if (studioClosed) {
      return;
    }

    const keyTimestamp = Date.now();

    if (key.name === "pageup" || key.name === "ppage" || key.name === "pagedown" || key.name === "npage") {
      return;
    }

    if (key.name === "escape" && !key.ctrl && !key.meta) {
      lastStandaloneEscapeAt = keyTimestamp;
      return;
    }

    const completionDirection = resolvePathCompletionDirectionFromKeypress(ch, key);
    if (completionDirection !== null) {
      lastStandaloneEscapeAt = null;
      await cycleComposerCompletion(completionDirection);
      return;
    }

    if (key.name === "up" && !key.ctrl && !key.meta) {
      lastStandaloneEscapeAt = null;
      restoreCommandFromHistory(-1);
      return;
    }

    if (key.name === "down" && !key.ctrl && !key.meta) {
      lastStandaloneEscapeAt = null;
      restoreCommandFromHistory(1);
      return;
    }

    if (key.name === "enter" && !key.shift && !key.meta && !key.ctrl) {
      if (shouldTreatEnterAsPastedNewline(lastComposerInputAt, rapidComposerInputChars)) {
        appendComposerNewline();
        return;
      }

      await submitComposer();
      return;
    }

    if ((key.name === "enter" && (key.shift || key.meta)) || (key.ctrl && key.name === "j")) {
      lastStandaloneEscapeAt = null;
      appendComposerNewline();
      return;
    }

    if (
      shouldDeletePreviousWordFromComposer(
        key,
        wasEscPrefixForWordDelete(lastStandaloneEscapeAt, keyTimestamp, ESC_META_GRACE_MS) && isBackspaceOrDeleteKey(key)
      )
    ) {
      lastStandaloneEscapeAt = null;
      resetCommandHistoryNavigation();
      resetComposerInputBurst();
      clearCompletionState();
      clearCompletionHint();
      composerValue = removeLastWordChunk(composerValue);
      renderComposer();
      setFooter();
      screen.render();
      return;
    }

    if (key.name === "backspace") {
      lastStandaloneEscapeAt = null;
      resetCommandHistoryNavigation();
      resetComposerInputBurst();
      clearCompletionState();
      clearCompletionHint();
      composerValue = removeLastCodePoint(composerValue);
      renderComposer();
      setFooter();
      screen.render();
      return;
    }

    if (key.ctrl || key.meta) {
      lastStandaloneEscapeAt = null;
      return;
    }

    const normalizedChunk = normalizeComposerInputChunk(ch, lastComposerInputAt, rapidComposerInputChars);
    if (normalizedChunk) {
      lastStandaloneEscapeAt = null;
      resetCommandHistoryNavigation();
      clearCompletionState();
      clearCompletionHint();
      composerValue += normalizedChunk;
      noteComposerInput(normalizedChunk);
      renderComposer();
      setFooter();
      screen.render();
      return;
    }

    if (lastStandaloneEscapeAt !== null && keyTimestamp - lastStandaloneEscapeAt > ESC_META_GRACE_MS) {
      lastStandaloneEscapeAt = null;
    }
  });

  screen.key(["C-c"], () => {
    if (busyMode === "auto") {
      void requestAutoRunStop(workspace, { planId });
      return;
    }

    closeStudio();
  });

  for (const element of [screen, transcript, input]) {
    element.key(transcriptScrollProfile.pageUpKeys, () => {
      scrollTranscript(-5);
    });

    element.key(transcriptScrollProfile.pageDownKeys, () => {
      scrollTranscript(5);
    });
  }

  renderTranscript();
  renderComposer();
  setSidebar("booting...");
  setFooter(" Starting studio... ");
  screen.program.hideCursor();
  screen.render();
  input.focus();
  await refreshEnvironment();
  await ensureFirstRunOrientation();

  if (!studioClosed && studioMode === "operate") {
    await appendSystemMessage("Operate mode boot: running `/go` using the current operate config.");
    await handleSlashCommand("/go");
  }

  if (!studioClosed) {
    await new Promise<void>((resolve) => {
      screen.once("destroy", () => resolve());
    });
  }

  async function ensureFirstRunOrientation(): Promise<void> {
    if (!latestPackState || !isDefaultStudioSession(historyMessages)) {
      return;
    }

    const lines = [renderFirstRunOrientationMessage(workspace, latestPackState, studioMode)];

    if (studioMode === "operate") {
      const operateConfig = await loadStudioOperateConfig(workspace, { planId });
      lines.push("", renderOperateKickoffMessage(operateConfig));
    }

    await appendSystemMessage(lines.join("\n"));
  }
}

function describeBusyMode(mode: BusyMode): string {
  switch (mode) {
    case "planner":
      return `waiting on ${getPrimaryAgentAdapter().label} planner`;
    case "pack":
      return `writing planning pack via ${getPrimaryAgentAdapter().label}`;
    case "run":
      return `executing next-agent prompt via ${getPrimaryAgentAdapter().label}`;
    case "auto":
      return `running auto mode via ${getPrimaryAgentAdapter().label}`;
  }
}

export function resolveTranscriptScrollProfile(platform: NodeJS.Platform = process.platform): TranscriptScrollProfile {
  if (platform === "darwin") {
    return {
      footerHint: "Fn+Up/Fn+Down scroll",
      helpLine:
        "- `Fn+Up` and `Fn+Down` scroll the transcript (`PageUp`/`PageDown` on external keyboards). `Ctrl+U`/`Ctrl+D` also works.",
      pageUpKeys: [...TRANSCRIPT_PAGE_UP_KEYS],
      pageDownKeys: [...TRANSCRIPT_PAGE_DOWN_KEYS]
    };
  }

  return {
    footerHint: "PgUp/PgDn scroll",
    helpLine: "- `PageUp` and `PageDown` scroll the transcript. `Ctrl+U`/`Ctrl+D` also works.",
    pageUpKeys: [...TRANSCRIPT_PAGE_UP_KEYS],
    pageDownKeys: [...TRANSCRIPT_PAGE_DOWN_KEYS]
  };
}

export function resolveStudioTerminal(
  platform: NodeJS.Platform = process.platform,
  term = process.env.TERM ?? ""
): string {
  const normalized = term.trim().toLowerCase();

  if (!normalized) {
    return STUDIO_TERMINAL_FALLBACK;
  }

  if (platform !== "darwin") {
    return normalized;
  }

  return SAFE_MAC_STUDIO_TERMINALS.has(normalized) ? normalized : STUDIO_TERMINAL_FALLBACK;
}

function buildReadyFooter(scrollHint: string, studioMode: StudioMode): string {
  if (studioMode === "operate") {
    return ` ${scrollHint}   /go run configured operate flow   /unblock retry blocked step   /stop auto stop   /help commands   /quit exit `;
  }

  return ` ${scrollHint}   Enter send   Shift+Enter newline   /agents [id] tool   /help commands   /quit exit `;
}

export function clampTranscriptStartIndex(transcriptStartIndex: number, messageCount: number): number {
  if (!Number.isFinite(transcriptStartIndex)) {
    return 0;
  }

  const normalizedStartIndex = Math.trunc(transcriptStartIndex);
  return Math.min(Math.max(0, normalizedStartIndex), Math.max(0, messageCount));
}

export function getVisibleTranscriptMessages(messages: ChatMessage[], transcriptStartIndex: number): ChatMessage[] {
  return messages.slice(clampTranscriptStartIndex(transcriptStartIndex, messages.length));
}

function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function formatTrackerSummary(currentPosition: PlanningCurrentPosition): string {
  if (!currentPosition.lastCompleted && !currentPosition.nextRecommended) {
    return "current position unavailable";
  }

  const lines = [
    `last: ${currentPosition.lastCompleted ?? "unknown"}`,
    `next: ${currentPosition.nextRecommended ?? "none queued"}`
  ];

  if (currentPosition.updatedAt) {
    lines.push(`updated: ${currentPosition.updatedAt}`);
  }

  return lines.join("\n");
}

function formatExecutionSummary(execution: {
  status: "success" | "failure";
  source: "studio" | "run-next";
  updatedAt: string;
  summary: string;
} | null): string {
  if (!execution) {
    return "no execution recorded yet";
  }

  const label = execution.status === "success" ? "success" : "failure";
  return `${label} via ${execution.source}\n${execution.updatedAt}\n${execution.summary}`;
}

function formatAutoSummary(packState: PlanningPackState | null): string {
  if (!packState?.autoRun) {
    return "idle";
  }

  const lines: string[] = [packState.autoRun.status];

  if (packState.autoRun.maxSteps) {
    lines.push(`steps: ${packState.autoRun.stepsAttempted}/${packState.autoRun.maxSteps}`);
  } else {
    lines.push(`steps: ${packState.autoRun.stepsAttempted}`);
  }

  if (packState.autoRun.stopReason) {
    lines.push(packState.autoRun.stopReason);
  }

  return lines.join("\n");
}

function formatAdviceSummary(advice: PlanningAdviceState | null, studioMode: StudioMode): string {
  if (!advice) {
    return studioMode === "plan" ? "run /advice for AI guidance" : "available in studio plan mode";
  }

  const lines = [
    `problem: ${advice.problemStatement}`,
    `clarity: ${advice.clarity}`,
    `next: ${advice.nextAction}`
  ];

  return lines.join("\n");
}

function formatAgentSummary(activeAgent: AgentStatus, statuses: AgentStatus[]): string {
  return [`active: ${activeAgent.label}`, ...statuses.map((status) => formatAgentStatusLine(status, status.id === activeAgent.id))]
    .join("\n");
}

export function buildStudioHeaderContent(workspace: string, packState: PlanningPackState | null): string {
  const workspaceName = path.basename(workspace) || workspace;
  const packLabel = packState ? formatPlanningPackPill(packState) : "{#ffb14a-fg}PACK STATUS LOADING{/}";
  return ` {bold}SRGICAL STUDIO{/bold}   ${workspaceName}   ${packLabel}`;
}

export function formatPlanningPackSummary(workspace: string, packState: PlanningPackState): string {
  const planId = packState.planId ?? "default";
  const readinessScore = packState.readiness?.score ?? 0;
  const readinessTotal = packState.readiness?.total ?? 4;
  const docsPresent = packState.docsPresent ?? (packState.packPresent ? 5 : 0);
  const lines = [
    `state: ${describePlanningPackState(packState)}`,
    `plan: ${planId}`,
    `dir: ${getPlanningPackPaths(workspace, { planId }).relativeDir}`,
    `docs: ${docsPresent}/5`,
    `readiness: ${readinessScore}/${readinessTotal}`,
    `human gate: ${
      requiresHumanWriteConfirmation(packState)
        ? packState.humanWriteConfirmed
          ? "confirmed"
          : "pending"
        : "not required for first scaffolded draft"
    }`
  ];

  const mode = deriveDisplayMode(packState);
  const readyToWrite = packState.readiness?.readyToWrite ?? false;

  if (mode === "Gathering Context" || mode === "Ready to Write") {
    lines.push(
      readyToWrite
        ? packState.packMode === "scaffolded"
          ? "next: /write will generate the first grounded draft from this transcript"
          : packState.humanWriteConfirmed
            ? "next: /write will refresh the authored planning doc set"
            : "next: /review, /open all, and /confirm-plan before /write"
        : "next: keep gathering context or run /readiness"
    );
  } else if (mode === "Ready to Execute" || mode === "Execution Active" || mode === "Auto Running") {
    lines.push("next: /preview, /run, or /auto when ready");
  } else if (!packState.packPresent) {
    lines.push("next: /plan new <id> to create the planning doc set");
  } else {
    lines.push("next: add or queue the next execution-ready step");
  }

  return lines.join("\n");
}

export function renderWorkspaceSelectionMessage(workspace: string, packState: PlanningPackState): string {
  const planId = packState.planId ?? "default";

  return [
    "Planning view:",
    `- workspace: ${workspace}`,
    `- active plan: ${planId}`,
    `- planning dir: ${getPlanningPackPaths(workspace, { planId }).relativeDir}`,
    `- plan status: ${describePlanningPackState(packState)}`,
    `- readiness: ${packState.readiness.score}/${packState.readiness.total}`,
    `- human write gate: ${packState.humanWriteConfirmed ? "confirmed" : "pending"}`,
    "",
    "Use `/workspace <path>` to switch repos.",
    "Use `/plans` to inspect plan directories and `/plan <id>` to switch plans.",
    "Use `/read <path>` to inject large file context directly into the transcript.",
    !packState.packPresent || packState.mode === "Gathering Context" || packState.mode === "Ready to Write"
      ? packState.packMode === "scaffolded"
        ? "Use `/write` to generate the first grounded draft once readiness is satisfied."
        : "Use `/review`, `/open all`, `/confirm-plan`, then `/write` to refresh the authored plan."
      : "Use `/write` when you want to refresh the selected plan from this transcript."
  ].join("\n");
}

function renderFirstRunOrientationMessage(workspace: string, packState: PlanningPackState, studioMode: StudioMode): string {
  if (studioMode === "operate") {
    return [
      "Welcome to srgical operate.",
      "This view is for running the plan, not discovering it.",
      "",
      renderWorkspaceSelectionMessage(workspace, packState),
      "",
      "Fast path:",
      "1. Use `/preview` if you want to inspect the current execution handoff.",
      "2. Use `/go` for the guided operate loop, `/run` for one step, or `/auto [max]` for direct bounded execution.",
      "3. If something blocks, use `/unblock` or `/unblock analyze [focus]`.",
      "4. Use `/status` when you want a clean read on what changed."
    ].join("\n");
  }

  return [
    "Welcome to srgical plan.",
    "You are at the start of a fresh planning conversation, so here is the shortest path from zero to execution.",
    "",
    renderWorkspaceSelectionMessage(workspace, packState),
    "",
    "Fast path:",
    "1. Tell the planner what you are building, what is already true in the repo, and the main constraint or risk.",
    "2. Use `/read [path]` to inject real repo files instead of describing them from memory.",
    "3. If you want to interrogate what just happened, use `/assess [focus]`, `/gather [focus]`, `/gaps [focus]`, `/ready [focus]`, `/status`, or `/readiness`.",
    "4. Once the direction is solid, run `/write` for the first grounded draft.",
    "5. Review with `/review`, open files with `/open all`, then run `/confirm-plan` before refreshing an authored plan.",
    "6. When the tracker is execution-ready, open `srgical studio operate <plan>` or run `srgical studio operate --plan <id>`.",
    "",
    "If you are not sure what to say first, paste the problem statement, a goal, or a file path and we will work forward from there."
  ].join("\n");
}

function renderAgentSelectionMessage(activeAgent: AgentStatus, statuses: AgentStatus[]): string {
  return [
    `Current active agent: ${activeAgent.label}${activeAgent.available ? "" : " (selected but currently unavailable)"}`,
    "",
    "Detected support:",
    ...statuses.map((status) => formatAgentStatusLine(status, status.id === activeAgent.id))
  ].join("\n");
}

function buildAgentUsageMessage(): string {
  const usages = getSupportedAgentAdapters().map((adapter) => `\`/agents ${adapter.id}\``);
  const aliasHint = "Alias: `/agent <id>`.";

  if (usages.length === 0) {
    return `Usage: \`/agents <id>\`. ${aliasHint}`;
  }

  if (usages.length === 1) {
    return `Usage: ${usages[0]}. ${aliasHint}`;
  }

  if (usages.length === 2) {
    return `Usage: ${usages[0]} or ${usages[1]}. ${aliasHint}`;
  }

  return `Usage: ${usages.slice(0, -1).join(", ")}, or ${usages[usages.length - 1]}. ${aliasHint}`;
}

export function parseAgentSelectionCommand(command: string): AgentSelectionCommand | null {
  const normalized = command.trim();

  if (normalized === "/agents") {
    return { kind: "status" };
  }

  if (normalized === "/agent") {
    return { kind: "usage" };
  }

  if (normalized.startsWith("/agents ")) {
    const requestedId = normalized.slice("/agents".length).trim().toLowerCase();
    return requestedId ? { kind: "select", requestedId } : { kind: "status" };
  }

  if (normalized.startsWith("/agent ")) {
    const requestedId = normalized.slice("/agent".length).trim().toLowerCase();
    return requestedId ? { kind: "select", requestedId } : { kind: "usage" };
  }

  return null;
}

function formatAgentStatusLine(status: AgentStatus, selected: boolean): string {
  const prefix = selected ? "*" : "-";
  const detail = status.available ? `ready (${status.version ?? "version unknown"})` : formatUnavailableAgentDetail(status);

  return `${prefix} ${status.id}: ${detail}`;
}

function formatUnavailableAgentDetail(status: AgentStatus): string {
  const reason = status.error ?? "unknown issue";
  return reason.toLowerCase().includes("install ") ? `on deck (${reason})` : `attention needed (${reason})`;
}

export function resolveStudioWorkspaceInput(currentWorkspace: string, requestedWorkspace: string): string {
  const trimmed = requestedWorkspace.trim();

  if (!trimmed) {
    return currentWorkspace;
  }

  const pathModule = shouldUseWindowsPathSemantics(currentWorkspace, trimmed) ? path.win32 : path;
  return pathModule.isAbsolute(trimmed) ? pathModule.resolve(trimmed) : pathModule.resolve(currentWorkspace, trimmed);
}

function shouldUseWindowsPathSemantics(currentWorkspace: string, requestedWorkspace: string): boolean {
  return (
    isWindowsAbsolutePath(currentWorkspace) ||
    isWindowsAbsolutePath(requestedWorkspace) ||
    isWindowsUncPath(currentWorkspace) ||
    isWindowsUncPath(requestedWorkspace)
  );
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function isWindowsUncPath(value: string): boolean {
  return /^\\\\[^\\]+\\[^\\]+/.test(value);
}

function isDefaultStudioSession(messages: ChatMessage[]): boolean {
  return (
    messages.length === DEFAULT_STUDIO_MESSAGES.length &&
    messages.every(
      (message, index) =>
        message.role === DEFAULT_STUDIO_MESSAGES[index]?.role &&
        message.content === DEFAULT_STUDIO_MESSAGES[index]?.content
    )
  );
}

function describePlanningPackState(packState: PlanningPackState): string {
  const mode = deriveDisplayMode(packState).toLowerCase();
  const boilerplateLabel =
    packState.packPresent && packState.packMode === "scaffolded" && packState.docsPresent === 0
      ? "boilerplate scaffold"
      : null;

  return [boilerplateLabel, `${mode}${packState.hasFailureOverlay ? " (last run failed)" : ""}`].filter(Boolean).join(" / ");
}

function formatPlanningPackPill(packState: PlanningPackState): string {
  const planId = packState.planId ?? "default";
  const mode = deriveDisplayMode(packState);

  if (mode === "Auto Running") {
    return `{#4de2c5-fg}PLAN ${planId.toUpperCase()} | AUTO RUNNING{/}`;
  }

  if (!packState.packPresent) {
    return `{#ffb14a-fg}PLAN ${planId.toUpperCase()} | NO PACK{/}`;
  }

  if (packState.hasFailureOverlay) {
    return `{#ff7a59-fg}PLAN ${planId.toUpperCase()} | ${mode.toUpperCase()} | FAILED{/}`;
  }

  if (mode === "Ready to Execute" || mode === "Execution Active") {
    return `{#4de2c5-fg}PLAN ${planId.toUpperCase()} | ${mode.toUpperCase()}{/}`;
  }

  return `{#ffb14a-fg}PLAN ${planId.toUpperCase()} | ${mode.toUpperCase()}{/}`;
}

function deriveDisplayMode(packState: PlanningPackState): string {
  if (packState.mode) {
    return packState.mode;
  }

  if (!packState.packPresent) {
    return "No Pack";
  }

  if (packState.currentPosition?.nextRecommended) {
    return "Execution Active";
  }

  return packState.trackerReadable ? "Plan Written - Needs Step" : "Gathering Context";
}

function renderStatusMessage(workspace: string, packState: PlanningPackState): string {
  const lines = [
    `Plan: ${packState.planId}`,
    `Planning dir: ${getPlanningPackPaths(workspace, { planId: packState.planId }).relativeDir}`,
    `Mode: ${packState.mode}${packState.hasFailureOverlay ? " [last run failed]" : ""}`,
    `Document state: ${
      packState.packPresent && packState.packMode === "scaffolded" && packState.docsPresent === 0
        ? "boilerplate scaffold"
        : packState.packMode === "authored"
          ? "grounded pack"
          : "mixed or partial"
    }`,
    `Docs: ${packState.docsPresent}/5`,
    `Readiness: ${packState.readiness.score}/${packState.readiness.total}${packState.readiness.readyToWrite ? " (ready to write)" : ""}`,
    `Human write gate: ${
      requiresHumanWriteConfirmation(packState)
        ? packState.humanWriteConfirmed
          ? `confirmed (${packState.humanWriteConfirmedAt ?? "timestamp unavailable"})`
          : "pending"
        : "not required for first scaffolded draft"
    }`,
    `Execution activated: ${packState.executionActivated ? "yes" : "no"}`,
    `Auto mode: ${packState.autoRun?.status ?? "idle"}`,
    `Next step: ${packState.nextStepSummary?.id ?? packState.currentPosition.nextRecommended ?? "none queued"}`
  ];

  if (packState.advice) {
    lines.push(`Advice next: ${packState.advice.nextAction}`);
  }

  return lines.join("\n");
}

function renderReadinessMessage(packState: PlanningPackState): string {
  return [
    `Readiness for plan \`${packState.planId}\`: ${packState.readiness.score}/${packState.readiness.total}${packState.readiness.readyToWrite ? " (ready to write)" : ""}`,
    "",
    ...packState.readiness.checks.map((check) => `- ${check.passed ? "[x]" : "[ ]"} ${check.label}`),
    "",
    packState.readiness.missingLabels.length > 0
      ? `Missing: ${packState.readiness.missingLabels.join(", ")}`
      : "Missing: none",
    `Human write gate: ${
      requiresHumanWriteConfirmation(packState)
        ? packState.humanWriteConfirmed
          ? "confirmed"
          : "pending"
        : "not required for first scaffolded draft"
    }`,
    packState.readiness.readyToWrite
      ? packState.packMode === "scaffolded"
        ? "Next: run `/write` to generate the first grounded draft."
        : packState.humanWriteConfirmed
          ? "Next: run `/write` to refresh the authored planning doc set."
          : "Next: run `/review`, then `/confirm-plan` before `/write`."
      : "Next: keep gathering repo truth, constraints, and the first execution slice."
  ].join("\n");
}

function renderAdviceMessage(advice: PlanningAdviceState): string {
  return [
    `Problem: ${advice.problemStatement}`,
    `Clarity: ${advice.clarity}`,
    `Assessment: ${advice.stateAssessment}`,
    `Research: ${advice.researchNeeded.length > 0 ? advice.researchNeeded.join(" | ") : "none"}`,
    `Advice: ${advice.advice}`,
    `Next: ${advice.nextAction}`
  ].join("\n");
}

function parsePlanInterrogationCommand(command: string): PlanInterrogationRequest | null {
  const match = command.trim().match(/^\/(assess|gather|gaps|ready)(?:\s+(.+))?$/i);

  if (!match) {
    return null;
  }

  const normalized = match[1]?.toLowerCase() as PlanInterrogationCommand;
  const focusText = match[2]?.trim() ?? "";
  const label = normalized === "ready" ? "readiness" : normalized;

  return {
    command: normalized,
    focusText,
    label
  };
}

function parseUnblockCommand(command: string): UnblockCommandRequest {
  const raw = command.slice("/unblock".length).trim();

  if (!raw) {
    return {
      mode: "retry",
      requestedStepId: null,
      reason: null
    };
  }

  const lower = raw.toLowerCase();
  if (lower === "help" || lower === "-h" || lower === "--help") {
    return { mode: "usage" };
  }

  if (lower === "analyze" || lower.startsWith("analyze ")) {
    return {
      mode: "analyze",
      focusText: raw.slice("analyze".length).trim()
    };
  }

  const retryPayload = lower === "retry" || lower.startsWith("retry ") ? raw.slice("retry".length).trim() : raw;
  const [firstTokenRaw = ""] = retryPayload.split(/\s+/, 1);
  const firstToken = normalizeStepToken(firstTokenRaw);
  const stepId = isLikelyStepId(firstToken) ? firstToken.toUpperCase() : null;
  const reason = stepId ? retryPayload.slice(firstTokenRaw.length).trim() : retryPayload;

  return {
    mode: "retry",
    requestedStepId: stepId,
    reason: reason.length > 0 ? reason : null
  };
}

function normalizeStepToken(value: string): string {
  return value.replace(/^["'`]|["'`]$/g, "");
}

function isLikelyStepId(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*-\d+$/.test(value);
}

function renderUnblockUsageMessage(): string {
  return [
    "Unblock commands:",
    "- `/unblock`: mark the current blocked `Next Recommended` step as `pending` and queue a retry.",
    "- `/unblock <STEP_ID>`: unblock a specific blocked step.",
    "- `/unblock retry [STEP_ID] [reason]`: explicit retry variant.",
    "- `/unblock analyze [focus]`: ask for root-cause and unblock guidance without changing tracker state."
  ].join("\n");
}

function isOperateOnlyCommand(command: string): boolean {
  return (
    command === "/go" ||
    command.startsWith("/go ") ||
    command === "/preview" ||
    command === "/run" ||
    command === "/stop" ||
    command === "/unblock" ||
    command.startsWith("/unblock ") ||
    command.startsWith("/auto")
  );
}

function isPlanOnlyCommand(command: string): boolean {
  return (
    command === "/write" ||
    command === "/readiness" ||
    command === "/advice" ||
    command === "/assess" ||
    command.startsWith("/assess ") ||
    command === "/gather" ||
    command.startsWith("/gather ") ||
    command === "/gaps" ||
    command.startsWith("/gaps ") ||
    command === "/ready" ||
    command.startsWith("/ready ") ||
    command === "/read" ||
    command.startsWith("/read ")
  );
}

function parseRequestedMaxSteps(rawValue: string): number | null | undefined {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return Math.floor(parsed);
}

export function renderPlanHelpMessage(transcriptHelpLine: string): string {
  return [
    "Mode: planning studio (`srgical studio plan` / `ssp`).",
    "",
    "Workflow:",
    "1. Talk normally to sharpen the plan against the real repo.",
    "2. Use `/plans`, `/plan`, and `/plan new <id>` to manage named planning packs in this workspace.",
    "3. Use `/read [path]` to inject repo files into the transcript for context gathering (`/read` defaults to current directory, non-recursive).",
    "4. Use `/assess [focus]` to assess objective clarity and execution confidence against current planning docs.",
    "5. Use `/gather [focus]` to gather missing context and refine what should be added next.",
    "6. Use `/gaps [focus]` to isolate blocking missing details.",
    "7. Use `/ready [focus]` for a GO/NO-GO execution readiness verdict.",
    "8. Use `/readiness` for deterministic readiness checks before writing the pack.",
    "9. Run `/write` to generate the first grounded draft from the transcript.",
    "10. Then run `/review` and `/open [all|plan|context|tracker|prompt|handoff|dir|<path>]` for human review.",
    "11. Run `/confirm-plan` to approve subsequent refresh writes.",
    "12. Run `/write` again when you want to refresh an authored plan.",
    "13. Use `/agents` to inspect support and `/agents <id>` (or `/agent <id>`) to switch the active tool.",
    "14. Use `/clear` to clear the visible transcript while preserving planning history, then `/history` to restore it.",
    "15. Open `srgical studio operate --plan <id>` (or `sso`) when you are ready to automate execution.",
    "",
    "Controls:",
    "- `Enter` sends the current message or command.",
    "- `Up` / `Down` cycles previously submitted slash commands.",
    "- `Shift+Enter`, `Alt+Enter`, or `Ctrl+J` inserts a new line when the terminal exposes those keys distinctly.",
    "- `Ctrl+W`, `Alt/Option+Backspace`, or `Ctrl+Backspace` deletes the previous word in the composer.",
    "- `/read [path] <follow-up>` auto-sends the follow-up text as the next user prompt after file context is loaded.",
    "- `/workspace <path> <follow-up>` auto-sends the follow-up text after a successful workspace switch.",
    "- Large paste blocks are accepted directly; no delimiter syntax is required.",
    "- `Tab` / `Shift+Tab` cycles path completions for `/read`, `/open`, `/workspace`, and existing `/plan` ids.",
    "- Mouse clicks are not captured so native terminal drag-selection stays available; use `/copy ...` if your terminal still behaves awkwardly.",
    "- `/copy`, `/copy visible`, `/copy all`, or `/copy last` copies transcript text through the OS clipboard.",
    "- Planner, `/write`, `/assess`, `/gather`, `/gaps`, and `/ready` stream model output live in the transcript while the CLI call is in flight.",
    transcriptHelpLine,
    "- `/quit` closes the studio."
  ].join("\n");
}

export function renderOperateHelpMessage(transcriptHelpLine: string): string {
  return [
    "Mode: operate studio (`srgical studio operate` / `sso`).",
    "",
    "Workflow:",
    "1. Use `/go` to run the configured operate loop.",
    "2. `/go [max]` runs auto mode until completion (or max cap) when pause-for-PR is disabled.",
    "3. If pause-for-PR is enabled, `/go` runs one step, pauses, then asks you to open a PR before continuing.",
    "4. If auto mode stops on a blocked step, run `/unblock` (or `/unblock <STEP_ID>`) to mark it pending for retry.",
    "5. Use `/unblock analyze [focus]` when you want root-cause guidance before retrying.",
    "6. Use `/preview` for dry-run prompt preview, `/run` for one step, `/auto [max]` for direct auto mode.",
    "7. Use `/stop` to request auto-run stop after the current iteration.",
    "8. Use `srgical studio config --plan <id>` (or `ssc`) to manage pause-for-PR and reference guidance paths.",
    "",
    "Controls:",
    "- Operate mode is slash-command only. Use `srgical studio plan` for planning conversation.",
    "- `Up` / `Down` cycles previously submitted slash commands.",
    "- `Tab` / `Shift+Tab` cycles path completions for `/open`, `/workspace`, and existing `/plan` ids.",
    "- Mouse clicks are not captured so native terminal drag-selection stays available; use `/copy ...` if your terminal still behaves awkwardly.",
    "- `/copy`, `/copy visible`, `/copy all`, or `/copy last` copies transcript text through the OS clipboard.",
    transcriptHelpLine,
    "- `/quit` closes the studio."
  ].join("\n");
}

function parseCopyCommand(command: string): CopyCommandMode | null {
  const normalized = command.trim().toLowerCase();

  if (normalized === "/copy" || normalized === "/copy visible") {
    return "visible";
  }

  if (normalized === "/copy all") {
    return "all";
  }

  if (normalized === "/copy last") {
    return "last";
  }

  return null;
}

function buildTranscriptCopyText(messages: ChatMessage[], transcriptStartIndex: number, mode: CopyCommandMode): string {
  const visibleMessages = getVisibleTranscriptMessages(messages, transcriptStartIndex);
  const selectedMessages =
    mode === "all" ? messages : mode === "last" ? (visibleMessages.length > 0 ? [visibleMessages[visibleMessages.length - 1]] : []) : visibleMessages;

  if (selectedMessages.length === 0) {
    throw new Error("There is no transcript content to copy yet.");
  }

  return selectedMessages
    .map((message) => `${message.role.toUpperCase()}\n${message.content}`)
    .join("\n\n");
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (process.platform === "win32") {
    await pipeTextToCommand("clip", [], text);
    return;
  }

  if (process.platform === "darwin") {
    await pipeTextToCommand("pbcopy", [], text);
    return;
  }

  const candidates: Array<{ command: string; args: string[] }> = [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] }
  ];

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      await pipeTextToCommand(candidate.command, candidate.args, text);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError instanceof Error ? lastError.message : "No supported clipboard command was available.");
}

function pipeTextToCommand(command: string, args: string[], text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "pipe"],
      shell: process.platform === "win32"
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });

    child.stdin.write(text);
    child.stdin.end();
  });
}

function renderPauseForPrMessage(config: StudioOperateConfig): string {
  const references =
    config.referencePaths.length > 0
      ? config.referencePaths.map((referencePath) => `- ${referencePath}`).join("\n")
      : "- none configured (`srgical studio config --add-reference <path>`)";

  return [
    "Pause-for-PR is enabled.",
    "Open a PR for the completed iteration before continuing.",
    "Configured guidance references:",
    references,
    "Run `/go` again after the PR checkpoint to continue."
  ].join("\n");
}

function renderOperateKickoffMessage(config: StudioOperateConfig): string {
  const references =
    config.referencePaths.length > 0 ? config.referencePaths.map((referencePath) => `- ${referencePath}`).join("\n") : "- none";

  return [
    "Operate mode settings:",
    `- pause for PR: ${config.pauseForPr ? "enabled" : "disabled"}`,
    "- guidance references:",
    references,
    "Run `/go` to start execution using this config."
  ].join("\n");
}

function removeLastCodePoint(value: string): string {
  return Array.from(value).slice(0, -1).join("");
}

export function normalizeComposerInputChunk(
  chunk: string,
  lastComposerInputAt: number | null,
  rapidComposerInputChars: number,
  now = Date.now()
): string | null {
  if (!chunk) {
    return null;
  }

  if (chunk === "\r" || chunk === "\n") {
    return shouldTreatEnterAsPastedNewline(lastComposerInputAt, rapidComposerInputChars, now) ? "\n" : null;
  }

  return /^[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]$/.test(chunk) ? null : chunk;
}

export function removeLastWordChunk(value: string): string {
  if (!value) {
    return value;
  }

  const codePoints = Array.from(value);
  let cursor = codePoints.length;

  while (cursor > 0 && /\s/.test(codePoints[cursor - 1] ?? "")) {
    cursor -= 1;
  }

  while (cursor > 0 && !/\s/.test(codePoints[cursor - 1] ?? "")) {
    cursor -= 1;
  }

  return codePoints.slice(0, cursor).join("");
}

export function shouldDeletePreviousWordFromComposer(key: ComposerEditKeyPress, precededByEscape = false): boolean {
  if (key.ctrl && key.name === "w") {
    return true;
  }

  if (precededByEscape && isBackspaceOrDeleteKey(key)) {
    return true;
  }

  if (key.full === "M-delete" || key.full === "M-backspace") {
    return true;
  }

  if (key.name === "backspace" && (key.meta || key.ctrl)) {
    return true;
  }

  if (key.name === "delete" && (key.meta || key.ctrl)) {
    return true;
  }

  if ((key.sequence === "\x1b\x7f" || key.sequence === "\x1b\b") && !key.ctrl) {
    return true;
  }

  return false;
}

function isBackspaceOrDeleteKey(key: ComposerEditKeyPress): boolean {
  return key.name === "backspace" || key.name === "delete";
}

export function wasEscPrefixForWordDelete(
  lastStandaloneEscapeAt: number | null,
  now = Date.now(),
  graceMs = ESC_META_GRACE_MS
): boolean {
  return lastStandaloneEscapeAt !== null && now - lastStandaloneEscapeAt <= graceMs;
}

function sanitizeModelOutputChunk(chunk: string): string {
  return chunk
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/\u0000/g, "");
}

function applyCompletionState(state: ComposerCompletionState): string {
  return `${state.seedValue.slice(0, state.replaceStart)}${state.matches[state.index] ?? ""}${state.seedValue.slice(state.replaceEnd)}`;
}

export function shouldTreatEnterAsPastedNewline(
  lastComposerInputAt: number | null,
  rapidComposerInputChars: number,
  now = Date.now(),
  options: { graceMs?: number; minChars?: number } = {}
): boolean {
  if (lastComposerInputAt === null) {
    return false;
  }

  const graceMs = options.graceMs ?? PASTE_ENTER_GRACE_MS;
  const minChars = options.minChars ?? PASTE_BURST_CHAR_THRESHOLD;
  return now - lastComposerInputAt <= graceMs && rapidComposerInputChars >= minChars;
}

export function appendCommandHistoryEntry(entries: string[], command: string): string[] {
  const normalized = command.trim();

  if (!normalized.startsWith("/")) {
    return entries;
  }

  if (entries[entries.length - 1] === normalized) {
    return entries;
  }

  const nextEntries = [...entries, normalized];
  return nextEntries.length > COMMAND_HISTORY_LIMIT ? nextEntries.slice(nextEntries.length - COMMAND_HISTORY_LIMIT) : nextEntries;
}

export function navigateCommandHistory(
  cursor: CommandHistoryCursor,
  currentValue: string,
  direction: CommandHistoryDirection
): { cursor: CommandHistoryCursor; value: string; changed: boolean } {
  if (cursor.entries.length === 0) {
    return {
      cursor,
      value: currentValue,
      changed: false
    };
  }

  if (direction < 0) {
    const nextIndex = cursor.index === null ? cursor.entries.length - 1 : Math.max(0, cursor.index - 1);
    return {
      cursor: {
        entries: cursor.entries,
        index: nextIndex,
        draft: cursor.index === null ? currentValue : cursor.draft
      },
      value: cursor.entries[nextIndex] ?? currentValue,
      changed: true
    };
  }

  if (cursor.index === null) {
    return {
      cursor,
      value: currentValue,
      changed: false
    };
  }

  if (cursor.index < cursor.entries.length - 1) {
    const nextIndex = cursor.index + 1;
    return {
      cursor: {
        entries: cursor.entries,
        index: nextIndex,
        draft: cursor.draft
      },
      value: cursor.entries[nextIndex] ?? currentValue,
      changed: true
    };
  }

  return {
    cursor: {
      entries: cursor.entries,
      index: null,
      draft: ""
    },
    value: cursor.draft,
    changed: true
  };
}

export function resolvePathCompletionDirectionFromKeypress(
  ch: string,
  key: ComposerCompletionKeyPress
): CompletionDirection | null {
  if (key.name === "tab") {
    return key.shift ? -1 : 1;
  }

  if (key.full === "S-tab" || key.sequence === "\x1b[Z") {
    return -1;
  }

  if (ch === "\t" || key.full === "C-i" || (key.ctrl && key.name === "i")) {
    return 1;
  }

  return null;
}

export async function parseReadCommandInput(workspace: string, rawInput: string): Promise<ReadCommandParseResult> {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return {
      requestedPath: "",
      trailingPrompt: null
    };
  }

  const quoted = parseLeadingQuotedValue(trimmed);
  if (quoted) {
    return {
      requestedPath: quoted.value,
      trailingPrompt: quoted.remainder.length > 0 ? quoted.remainder : null
    };
  }

  const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);

  for (let count = parts.length; count >= 1; count -= 1) {
    const candidatePath = parts.slice(0, count).join(" ");
    const absoluteCandidate = resolveStudioWorkspaceInput(workspace, candidatePath);

    if (await doesPathExist(absoluteCandidate)) {
      const trailing = parts.slice(count).join(" ").trim();
      return {
        requestedPath: candidatePath,
        trailingPrompt: trailing.length > 0 ? trailing : null
      };
    }
  }

  if (parts.length > 1) {
    return {
      requestedPath: parts[0] ?? "",
      trailingPrompt: parts.slice(1).join(" ").trim() || null
    };
  }

  return {
    requestedPath: trimmed,
    trailingPrompt: null
  };
}

export async function collectReadTargetFiles(workspace: string, requestedPath: string): Promise<ReadTargetFiles> {
  const absoluteTarget = resolveStudioWorkspaceInput(workspace, requestedPath);
  const details = await stat(absoluteTarget);

  if (!details.isDirectory()) {
    const relativeFile = normalizePathSeparators(path.relative(workspace, absoluteTarget), false) || absoluteTarget;
    return {
      files: [relativeFile],
      directoryLabel: null
    };
  }

  const entries = await readdir(absoluteTarget, { withFileTypes: true, encoding: "utf8" });
  const files = entries
    .filter((entry) => entry.isFile())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const absoluteFile = path.join(absoluteTarget, entry.name);
      return normalizePathSeparators(path.relative(workspace, absoluteFile), false) || absoluteFile;
    });
  const directoryLabel = normalizePathSeparators(path.relative(workspace, absoluteTarget), false) || ".";

  if (files.length === 0) {
    throw new Error(`\`${directoryLabel}\` has no files to read (non-recursive mode skips subdirectories).`);
  }

  return {
    files,
    directoryLabel
  };
}

export async function parseOpenCommandInput(workspace: string, rawInput: string): Promise<OpenCommandParseResult> {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return {
      target: "all",
      trailingPrompt: null
    };
  }

  const quoted = parseLeadingQuotedValue(trimmed);
  if (quoted) {
    return {
      target: quoted.value,
      trailingPrompt: quoted.remainder.length > 0 ? quoted.remainder : null
    };
  }

  const firstToken = trimmed.split(/\s+/, 1)[0] ?? "";
  if (OPEN_TARGET_ALIASES.includes(firstToken.toLowerCase() as (typeof OPEN_TARGET_ALIASES)[number])) {
    const trailingPrompt = trimmed.slice(firstToken.length).trim();
    return {
      target: firstToken,
      trailingPrompt: trailingPrompt.length > 0 ? trailingPrompt : null
    };
  }

  const parsedPath = await parseReadCommandInput(workspace, rawInput);
  return {
    target: parsedPath.requestedPath,
    trailingPrompt: parsedPath.trailingPrompt
  };
}

export function parseComposerPathCompletionRequest(composerValue: string): ComposerPathCompletionRequest | null {
  const lineStart = composerValue.lastIndexOf("\n") + 1;
  const line = composerValue.slice(lineStart);
  const commands = ["/read", "/open", "/workspace", "/plan"] as const;

  for (const command of commands) {
    if (!line.startsWith(command)) {
      continue;
    }

    const remainder = line.slice(command.length);

    if (remainder.length === 0) {
      return {
        command,
        token: "",
        replaceStart: composerValue.length,
        replaceEnd: composerValue.length
      };
    }

    if (!/^\s+/.test(remainder)) {
      return null;
    }

    const leadingWhitespaceLength = remainder.length - remainder.trimStart().length;
    const args = remainder.slice(leadingWhitespaceLength);

    if (command === "/plan") {
      if (args.toLowerCase() === "new" || args.toLowerCase().startsWith("new ") || /\s/.test(args)) {
        return null;
      }

      return {
        command,
        token: args,
        replaceStart: lineStart + command.length + leadingWhitespaceLength,
        replaceEnd: composerValue.length
      };
    }

    const lastSpaceIndex = args.lastIndexOf(" ");
    const tokenStartInArgs = lastSpaceIndex >= 0 ? lastSpaceIndex + 1 : 0;
    const token = args.slice(tokenStartInArgs);
    const replaceStart = lineStart + command.length + leadingWhitespaceLength + tokenStartInArgs;

    return {
      command,
      token,
      replaceStart,
      replaceEnd: composerValue.length
    };
  }

  return null;
}

function parseLeadingQuotedValue(value: string): { value: string; remainder: string } | null {
  const quote = value[0];

  if (quote !== "\"" && quote !== "'") {
    return null;
  }

  let escaped = false;

  for (let index = 1; index < value.length; index += 1) {
    const current = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (current === "\\") {
      escaped = true;
      continue;
    }

    if (current === quote) {
      return {
        value: value.slice(1, index),
        remainder: value.slice(index + 1).trim()
      };
    }
  }

  return null;
}

async function collectPathCompletionMatches(workspace: string, request: ComposerPathCompletionRequest): Promise<string[]> {
  if (request.command === "/plan") {
    const refs = await listPlanningDirectories(workspace);
    const seed = request.token.trim().toLowerCase();

    return refs
      .map((ref) => ref.planId)
      .filter((planOption) => planOption.toLowerCase().startsWith(seed))
      .sort((left, right) => left.localeCompare(right));
  }

  const normalizedToken = stripWrappingQuotes(request.token);
  const usesWindowsSemantics = shouldUseWindowsPathSemantics(workspace, normalizedToken);
  const pathModule = usesWindowsSemantics ? path.win32 : path;
  const preferBackslash = normalizedToken.includes("\\") && !normalizedToken.includes("/");
  const absoluteInput =
    normalizedToken.length === 0
      ? workspace
      : pathModule.isAbsolute(normalizedToken)
        ? pathModule.resolve(normalizedToken)
        : pathModule.resolve(workspace, normalizedToken);
  const tokenEndsWithSeparator = /[\\/]$/.test(normalizedToken);
  const lookupDirectory =
    normalizedToken.length === 0 || tokenEndsWithSeparator ? absoluteInput : pathModule.dirname(absoluteInput);
  const namePrefix = normalizedToken.length === 0 || tokenEndsWithSeparator ? "" : pathModule.basename(normalizedToken);

  let entries: Dirent<string>[] = [];
  try {
    entries = await readdir(lookupDirectory, { withFileTypes: true, encoding: "utf8" });
  } catch {
    entries = [];
  }

  const fileMatches = entries
    .filter((entry) => entry.name.toLowerCase().startsWith(namePrefix.toLowerCase()))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    })
    .map((entry) => {
      const absoluteCandidate = pathModule.join(lookupDirectory, entry.name);
      const relativeCandidate = pathModule.isAbsolute(normalizedToken)
        ? absoluteCandidate
        : pathModule.relative(workspace, absoluteCandidate) || ".";
      const normalizedCandidate = normalizePathSeparators(relativeCandidate, preferBackslash);
      return entry.isDirectory() ? appendTrailingSeparator(normalizedCandidate, preferBackslash) : normalizedCandidate;
    });

  if (request.command !== "/open") {
    return fileMatches;
  }

  const aliasMatches = OPEN_TARGET_ALIASES.filter((alias) => alias.startsWith(normalizedToken.toLowerCase()));
  const merged = [...aliasMatches, ...fileMatches];
  return Array.from(new Set(merged));
}

async function doesPathExist(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function normalizePathSeparators(value: string, preferBackslash: boolean): string {
  return preferBackslash ? value.replace(/\//g, "\\") : value.replace(/\\/g, "/");
}

function appendTrailingSeparator(value: string, preferBackslash: boolean): string {
  if (!value) {
    return value;
  }

  if (value.endsWith("/") || value.endsWith("\\")) {
    return value;
  }

  return `${value}${preferBackslash ? "\\" : "/"}`;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length >= 2 && ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function resolveOpenTargets(workspace: string, paths: PlanningPackPaths, target: string): string[] {
  const normalized = target.trim().toLowerCase();

  switch (normalized) {
    case "all":
      return [paths.plan, paths.context, paths.tracker, paths.handoff, paths.nextPrompt];
    case "plan":
      return [paths.plan];
    case "context":
      return [paths.context];
    case "tracker":
      return [paths.tracker];
    case "handoff":
      return [paths.handoff];
    case "prompt":
      return [paths.nextPrompt];
    case "dir":
      return [paths.dir];
    default:
      return target.trim().length > 0 ? [resolveStudioWorkspaceInput(workspace, stripWrappingQuotes(target))] : [];
  }
}

async function openInVsCode(targets: string[]): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn("code", targets, {
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32"
    });

    const finish = (result: { ok: boolean; reason?: string }) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    child.once("error", (error) => {
      finish({
        ok: false,
        reason: error instanceof Error ? error.message : String(error)
      });
    });

    setTimeout(() => {
      child.unref();
      finish({ ok: true });
    }, 60);
  });
}

async function loadFileContextMessage(workspace: string, requestedPath: string): Promise<string> {
  const absolutePath = resolveStudioWorkspaceInput(workspace, requestedPath);
  const details = await stat(absolutePath);

  if (details.isDirectory()) {
    throw new Error(`\`${requestedPath}\` is a directory. Point to a file path instead.`);
  }

  const relativePath = normalizePathSeparators(path.relative(workspace, absolutePath), false) || absolutePath;
  const raw = await readText(absolutePath);
  const normalized = raw.replace(/\r\n/g, "\n");
  const content = normalized.length <= CONTEXT_FILE_CHAR_LIMIT ? normalized : `${normalized.slice(0, CONTEXT_FILE_CHAR_LIMIT).trimEnd()}\n... [truncated]`;
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;

  return [
    `Loaded context file: \`${relativePath}\``,
    `Size: ${Math.min(normalized.length, CONTEXT_FILE_CHAR_LIMIT)} characters${normalized.length > CONTEXT_FILE_CHAR_LIMIT ? ` (truncated from ${normalized.length})` : ""}`,
    `Lines: ${lineCount}`,
    "",
    `===== BEGIN FILE ${relativePath} =====`,
    content,
    `===== END FILE ${relativePath} =====`
  ].join("\n");
}

function renderPlanUsageMessage(currentPlanId: string, paths: PlanningPackPaths): string {
  return [
    `Current plan: ${currentPlanId}`,
    `Planning dir: ${paths.relativeDir}`,
    "",
    "Commands:",
    "- `/plans` lists available plans",
    "- `/plan <id>` switches the active plan",
    "- `/plan new <id>` creates a named plan scaffold",
    "- `Tab` after `/plan ` cycles known plan ids",
    "- `/read <path>` injects a file into the transcript as context",
    "- `/assess [focus]` assesses objective and execution clarity",
    "- `/gather [focus]` gathers missing context and refinement actions",
    "- `/gaps [focus]` lists blocking missing details",
    "- `/ready [focus]` returns a GO/NO-GO readiness verdict",
    "- `/review` shows planning docs for human review",
    "- `/open all` opens planning docs in VS Code",
    "- `/open <path>` opens any repo file or folder in VS Code",
    "- `/confirm-plan` records explicit human approval required for authored-plan refresh writes"
  ].join("\n");
}

function requiresHumanWriteConfirmation(packState: PlanningPackState): boolean {
  return packState.packMode === "authored";
}

async function renderPlansMessage(workspace: string, currentPlanId: string): Promise<string> {
  const refs = await listPlanningDirectories(workspace);

  if (refs.length === 0) {
    return "No planning packs exist yet.\nUse `/plan new <id>` to create one.";
  }

  const states = await Promise.all(refs.map((ref) => readPlanningPackState(workspace, { planId: ref.planId })));

  return [
    "Plans:",
    ...states.map(
      (state) =>
        `- ${state.planId}${state.planId === currentPlanId ? " [active]" : ""}: ${state.packDir} | ${state.mode} | docs ${state.docsPresent}/5 | readiness ${state.readiness.score}/${state.readiness.total} | human ${state.humanWriteConfirmed ? "confirmed" : "pending"} | auto ${state.autoRun?.status ?? "idle"}`
    )
  ].join("\n");
}

async function createPlanScaffold(workspace: string, requestedPlanId: string): Promise<PlanningPackPaths> {
  const planId = normalizePlanId(requestedPlanId);
  const paths = await ensurePlanningDir(workspace, { planId });
  const templates = getInitialTemplates(paths);

  await Promise.all(Object.entries(templates).map(([filePath, content]) => writeText(filePath, content)));
  await clearPlanningPackRuntimeState(workspace, { planId });
  await savePlanningState(workspace, "scaffolded", { planId });
  await saveActivePlanId(workspace, planId);
  return paths;
}
