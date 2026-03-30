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
import type { ChatMessage } from "../core/prompts";
import { DEFAULT_STUDIO_MESSAGES, loadStoredActiveAgentId, loadStudioSession, saveStudioSession } from "../core/studio-session";
import { getInitialTemplates } from "../core/templates";
import {
  ensurePlanningDir,
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

type StudioOptions = {
  workspace?: string;
  planId?: string | null;
};

type BusyMode = "planner" | "pack" | "run" | "auto";
type CompletionDirection = 1 | -1;

type ComposerCompletionState = {
  seedValue: string;
  replaceStart: number;
  replaceEnd: number;
  matches: string[];
  index: number;
};

export type ComposerPathCompletionRequest = {
  command: "/read" | "/open" | "/workspace";
  token: string;
  replaceStart: number;
  replaceEnd: number;
};

export type AgentSelectionCommand =
  | { kind: "status" }
  | { kind: "usage" }
  | { kind: "select"; requestedId: string };

type TranscriptScrollProfile = {
  footerHint: string;
  helpLine: string;
  pageUpKeys: string[];
  pageDownKeys: string[];
};

const TRANSCRIPT_PAGE_UP_KEYS = ["pageup", "ppage", "C-u"];
const TRANSCRIPT_PAGE_DOWN_KEYS = ["pagedown", "npage", "C-d"];
const ACTIVITY_FRAMES = ["[    ]", "[=   ]", "[==  ]", "[=== ]", "[ ===]", "[  ==]", "[   =]"];
const COMPOSER_CURSOR = "{#ffb14a-fg}\u2588{/}";
const CONTEXT_FILE_CHAR_LIMIT = 120_000;
const COMPLETION_HINT_TTL_MS = 2500;
const RAPID_INPUT_INTERVAL_MS = 25;
const PASTE_ENTER_GRACE_MS = 45;
const PASTE_BURST_CHAR_THRESHOLD = 4;
const OPEN_TARGET_ALIASES = ["all", "plan", "context", "tracker", "handoff", "prompt", "dir"] as const;
const escapeBlessedText = (blessed as typeof blessed & { helpers: { escape(text: string): string } }).helpers.escape;

export async function launchStudio(options: StudioOptions = {}): Promise<void> {
  let workspace = resolveWorkspace(options.workspace);
  let planId = await resolvePlanId(workspace, options.planId);
  await saveActivePlanId(workspace, planId);
  let messages = await loadStudioSession(workspace, { planId });
  const transcriptScrollProfile = resolveTranscriptScrollProfile();
  const readyFooter = buildReadyFooter(transcriptScrollProfile.footerHint);
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: "srgical studio"
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
    label: " Control Room ",
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
    mouse: true,
    tags: true,
    clickable: true,
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
  let adviceSummary = "run /advice for AI guidance";
  let composerValue = "";
  let completionState: ComposerCompletionState | null = null;
  let completionHint: { text: string; expiresAt: number } | null = null;
  let lastComposerInputAt: number | null = null;
  let rapidComposerInputChars = 0;
  let liveStreamLabel: string | null = null;
  let liveStreamContent = "";
  let liveStreamRenderTimer: NodeJS.Timeout | undefined;

  function setSidebar(status?: string): void {
    const planningPaths = getPlanningPackPaths(workspace, { planId });

    sidebar.setContent(
      [
        "{bold}Workspace{/bold}",
        `root: ${workspace}`,
        `plan: ${planId}`,
        `plan dir: ${planningPaths.relativeDir}`,
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

  function startLiveStream(label: string): void {
    liveStreamLabel = label;
    liveStreamContent = "";
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

    liveStreamContent += sanitizedChunk;
    scheduleLiveStreamRender();
  }

  function stopLiveStream(): void {
    liveStreamLabel = null;
    liveStreamContent = "";
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
      renderTranscript();
      setFooter();
      screen.render();
    }, 60);
  }

  function renderTranscript(): void {
    const renderedMessages = messages
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

  async function appendMessage(message: ChatMessage): Promise<void> {
    messages.push(message);
    await saveStudioSession(workspace, messages, { planId });
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
    composerValue = "";
    resetComposerInputBurst();
    clearCompletionState();
    clearCompletionHint();
    renderComposer();

    if (!text || (busy && text !== "/stop")) {
      setFooter();
      screen.render();
      return;
    }

    if (text.startsWith("/")) {
      await handleSlashCommand(text);
      input.focus();
      renderComposer();
      setFooter();
      screen.render();
      return;
    }

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
      const reply = await requestPlannerReply(workspace, messages, {
        planId,
        onOutputChunk: appendLiveStreamChunk
      });
      stopLiveStream();
      await appendMessage({
        role: "assistant",
        content: reply
      });
      await refreshAdvice(false);
    } catch (error) {
      stopLiveStream();
      await appendMessage({
        role: "system",
        content: `Planner call failed: ${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      stopLiveStream();
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
    adviceSummary = formatAdviceSummary(packState.advice);
    setSidebar();
    setFooter();
    renderTranscript();
    renderComposer();
    screen.render();
  }

  async function switchPlan(nextPlanId: string): Promise<void> {
    planId = normalizePlanId(nextPlanId);
    await saveActivePlanId(workspace, planId);
    messages = await loadStudioSession(workspace, { planId });
    await refreshEnvironment();
  }

  async function refreshAdvice(showInTranscript = false): Promise<void> {
    try {
      const advice = await refreshPlanningAdvice(workspace, messages, { planId });
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

  async function handleSlashCommand(command: string): Promise<void> {
    if (command === "/quit") {
      stopLiveStream();
      screen.destroy();
      return;
    }

    if (command === "/workspace") {
      const packState = latestPackState ?? (await readPlanningPackState(workspace, { planId }));
      await appendSystemMessage(renderWorkspaceSelectionMessage(workspace, packState));
      return;
    }

    if (command.startsWith("/workspace")) {
      const requestedWorkspace = command.slice("/workspace".length).trim();

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
        messages = await loadStudioSession(workspace, { planId });
        await refreshEnvironment();
        await appendSystemMessage(
          [
            `Now looking at ${workspace}.`,
            "",
            renderWorkspaceSelectionMessage(workspace, latestPackState ?? (await readPlanningPackState(workspace, { planId })))
          ].join("\n")
        );
      } catch (error) {
        workspace = previousWorkspace;
        planId = previousPlanId;
        await refreshEnvironment();
        await appendSystemMessage(
          `Workspace switch blocked: ${
            error instanceof Error ? error.message : String(error)
          }\nUse \`/workspace <path>\` after creating or selecting a named plan in that repo.`
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

    if (command === "/read") {
      await appendSystemMessage("Usage: `/read <path>` (Tab completes paths).");
      return;
    }

    if (command.startsWith("/read ")) {
      const requestedPath = stripWrappingQuotes(command.slice("/read".length).trim());

      if (!requestedPath) {
        await appendSystemMessage("Usage: `/read <path>` (Tab completes paths).");
        return;
      }

      try {
        const contextMessage = await loadFileContextMessage(workspace, requestedPath);
        await appendSystemMessage(contextMessage);
      } catch (error) {
        await appendSystemMessage(`Could not read file: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    if (command.startsWith("/open")) {
      const requestedTarget = command.slice("/open".length).trim();
      const target = requestedTarget.length > 0 ? requestedTarget : "all";
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

    if (command === "/help") {
      await appendSystemMessage(
        [
          "Workflow:",
          "1. Talk normally to sharpen the plan against the real repo.",
          "2. Use `/plans`, `/plan`, and `/plan new <id>` to manage named planning packs in this workspace.",
          "3. Use `/read <path>` to inject repo files into the transcript for context gathering.",
          "4. Use `/readiness` to see what context is still missing before you write the pack.",
          "5. Run `/write` to generate the first grounded draft from the transcript.",
          "6. Then run `/review` and `/open [all|plan|context|tracker|prompt|handoff|dir|<path>]` for human review.",
          "7. Run `/confirm-plan` to approve subsequent refresh writes.",
          "8. Run `/write` again when you want to refresh an authored plan.",
          "9. Use `/agents` to inspect support and `/agents <id>` (or `/agent <id>`) to switch the active tool.",
          "10. Run `/preview` for a safe execution preview, `/run` for one execution step, or `/auto [max]` for continuous execution.",
          "11. Run `/stop` to stop auto mode after the current iteration.",
          "",
          "Controls:",
          "- `Enter` sends the current message or command.",
          "- `Shift+Enter`, `Alt+Enter`, or `Ctrl+J` inserts a new line when the terminal exposes those keys distinctly.",
          "- Large paste blocks are accepted directly; no delimiter syntax is required.",
          "- `Tab` / `Shift+Tab` cycles path completions for `/read`, `/open`, and `/workspace`.",
          "- Planner, `/write`, and `/run` stream model output live in the transcript while the CLI call is in flight.",
          transcriptScrollProfile.helpLine,
          "- `/quit` closes the studio."
        ].join("\n")
      );
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
        const result = await writePlanningPack(workspace, messages, {
          planId,
          onOutputChunk: appendLiveStreamChunk
        });
        stopLiveStream();
        await markPlanningPackAuthored(workspace, { planId });
        await refreshAdvice(false);
        await appendSystemMessage(`Planning pack updated for \`${planId}\`. Summary:\n${result}`);
      } catch (error) {
        stopLiveStream();
        await appendSystemMessage(`Pack generation failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        stopLiveStream();
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
        stopLiveStream();
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
        stopLiveStream();
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
        stopLiveStream();
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
      setCompletionHint("Path completion works with /read, /open, and /workspace.");
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

  input.on("click", () => {
    input.focus();
    screen.render();
  });

  input.on("keypress", async (ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
    if (key.name === "pageup" || key.name === "ppage" || key.name === "pagedown" || key.name === "npage") {
      return;
    }

    if (key.name === "tab") {
      await cycleComposerCompletion(key.shift ? -1 : 1);
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
      appendComposerNewline();
      return;
    }

    if (key.name === "backspace") {
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
      return;
    }

    if (ch && !/^[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]$/.test(ch)) {
      clearCompletionState();
      clearCompletionHint();
      composerValue += ch;
      noteComposerInput(ch);
      renderComposer();
      setFooter();
      screen.render();
    }
  });

  screen.key(["C-c"], () => {
    if (busyMode === "auto") {
      void requestAutoRunStop(workspace, { planId });
      return;
    }

    stopLiveStream();
    stopBusy();
    screen.destroy();
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

  async function ensureFirstRunOrientation(): Promise<void> {
    if (!latestPackState || !isDefaultStudioSession(messages)) {
      return;
    }

    await appendSystemMessage(renderWorkspaceSelectionMessage(workspace, latestPackState));
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

function buildReadyFooter(scrollHint: string): string {
  return ` ${scrollHint}   Enter send   Shift+Enter newline   /agents [id] tool   /help commands   /quit exit `;
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

function formatAdviceSummary(advice: PlanningAdviceState | null): string {
  if (!advice) {
    return "run /advice for AI guidance";
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
  return `${deriveDisplayMode(packState).toLowerCase()}${packState.hasFailureOverlay ? " (last run failed)" : ""}`;
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

function removeLastCodePoint(value: string): string {
  return Array.from(value).slice(0, -1).join("");
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

export function parseComposerPathCompletionRequest(composerValue: string): ComposerPathCompletionRequest | null {
  const lineStart = composerValue.lastIndexOf("\n") + 1;
  const line = composerValue.slice(lineStart);
  const commands = ["/read", "/open", "/workspace"] as const;

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

async function collectPathCompletionMatches(workspace: string, request: ComposerPathCompletionRequest): Promise<string[]> {
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
    "- `/read <path>` injects a file into the transcript as context",
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
  await savePlanningState(workspace, "scaffolded", { planId });
  await saveActivePlanId(workspace, planId);
  return paths;
}
