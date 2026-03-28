import path from "node:path";
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
import { refreshPlanningAdvice } from "../core/planning-advice";
import { readPlanningPackState, type PlanningCurrentPosition, type PlanningPackState } from "../core/planning-pack-state";
import { markPlanningPackAuthored, savePlanningState } from "../core/planning-state";
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

const READY_FOOTER = " PgUp/PgDn scroll   /agents choose tool   /help commands   /quit exit ";
const ACTIVITY_FRAMES = ["[    ]", "[=   ]", "[==  ]", "[=== ]", "[ ===]", "[  ==]", "[   =]"];
const COMPOSER_CURSOR = "{black-fg}{#ffb14a-bg} {/}";
const escapeBlessedText = (blessed as typeof blessed & { helpers: { escape(text: string): string } }).helpers.escape;

export async function launchStudio(options: StudioOptions = {}): Promise<void> {
  let workspace = resolveWorkspace(options.workspace);
  let planId = await resolvePlanId(workspace, options.planId);
  await saveActivePlanId(workspace, planId);
  let messages = await loadStudioSession(workspace, { planId });
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
    height: "100%-8",
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
    height: "100%-8",
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
    height: 4,
    keys: true,
    mouse: true,
    tags: true,
    clickable: true,
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
    content: READY_FOOTER
  });

  screen.append(header);
  screen.append(transcript);
  screen.append(sidebar);
  screen.append(input);
  screen.append(footer);

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
      return READY_FOOTER;
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

  function renderTranscript(): void {
    const rendered = messages
      .map((message) => {
        const tone =
          message.role === "user"
            ? "{#ffb14a-fg}YOU{/}"
            : message.role === "assistant"
              ? "{#4de2c5-fg}PLANNER{/}"
              : "{#ff7a59-fg}SYSTEM{/}";

        return `${tone}\n${message.content}`;
      })
      .join("\n\n");

    transcript.setContent(rendered);
    transcript.setScrollPerc(100);
  }

  function renderComposer(): void {
    const escapedValue = escapeBlessedText(composerValue);
    input.setContent(`${escapedValue}${COMPOSER_CURSOR}`);
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
    renderComposer();

    if (!text || (busy && text !== "/stop")) {
      screen.render();
      return;
    }

    if (text.startsWith("/")) {
      await handleSlashCommand(text);
      input.focus();
      renderComposer();
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

    try {
      const reply = await requestPlannerReply(workspace, messages, { planId });
      await appendMessage({
        role: "assistant",
        content: reply
      });
      await refreshAdvice(false);
    } catch (error) {
      await appendMessage({
        role: "system",
        content: `Planner call failed: ${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      stopBusy();
      renderTranscript();
      setSidebar();
      setFooter();
      renderComposer();
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

      workspace = nextWorkspace;
      planId = await resolvePlanId(workspace);
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
          "Use `/readiness` while gathering context, then `/write` when the plan is ready."
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

    if (command === "/agents") {
      const agentState = await resolvePrimaryAgent(workspace, { planId });
      await appendSystemMessage(renderAgentSelectionMessage(agentState.status, agentState.statuses));
      return;
    }

    if (command.startsWith("/agent")) {
      const requestedId = command.slice("/agent".length).trim().toLowerCase();

      if (!requestedId) {
        const agentState = await resolvePrimaryAgent(workspace, { planId });
        await appendSystemMessage([buildAgentUsageMessage(), "", renderAgentSelectionMessage(agentState.status, agentState.statuses)].join("\n"));
        return;
      }

      setSidebar("updating active agent...");
      setFooter(" Updating active agent selection... ");
      screen.render();

      try {
        const agentState = await selectPrimaryAgent(workspace, requestedId, { planId });
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
          "3. Use `/readiness` to see what context is still missing before you write the pack.",
          "4. Run `/advice` for an AI assessment of the problem statement, clarity, research gaps, and next move.",
          "5. Run `/write` when the plan is ready to put on disk.",
          "6. Run `/preview` for a safe execution preview, `/run` for one execution step, or `/auto [max]` for continuous execution.",
          "7. Run `/stop` to stop auto mode after the current iteration.",
          "",
          "Controls:",
          "- `Enter` sends the current message or command.",
          "- `Shift+Enter`, `Alt+Enter`, or `Ctrl+J` inserts a new line when the terminal exposes those keys distinctly.",
          "- `PageUp` and `PageDown` scroll the transcript.",
          "- `/quit` closes the studio."
        ].join("\n")
      );
      return;
    }

    if (command === "/preview") {
      const paths: PlanningPackPaths = getPlanningPackPaths(workspace, { planId });
      const packState = await readPlanningPackState(workspace, { planId });

      if (!packState.packPresent) {
        await appendSystemMessage("Execution preview unavailable: no planning pack was found for the selected plan yet.");
        return;
      }

      const prompt = await readText(paths.nextPrompt);
      await appendSystemMessage(
        renderDryRunPreview(prompt, packState.nextStepSummary, packState.currentPosition.nextRecommended).join("\n")
      );
      return;
    }

    if (command === "/write") {
      startBusy("pack");

      try {
        const result = await writePlanningPack(workspace, messages, { planId });
        await markPlanningPackAuthored(workspace, { planId });
        await refreshAdvice(false);
        await appendSystemMessage(`Planning pack updated for \`${planId}\`. Summary:\n${result}`);
      } catch (error) {
        await appendSystemMessage(`Pack generation failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        stopBusy();
        await refreshEnvironment();
      }

      return;
    }

    if (command === "/run") {
      const paths: PlanningPackPaths = getPlanningPackPaths(workspace, { planId });
      const packState = await readPlanningPackState(workspace, { planId });

      if (!hasQueuedNextStep(packState.currentPosition.nextRecommended)) {
        await appendSystemMessage(formatNoQueuedNextStepMessage("studio"));
        return;
      }

      startBusy("run");

      try {
        const prompt = await readText(paths.nextPrompt);
        const result = await runNextPrompt(workspace, prompt, { planId });
        await saveExecutionState(workspace, "success", "studio", result, { planId });
        await appendExecutionLog(workspace, "success", "studio", result, {
          planId,
          stepLabel: packState.nextStepSummary?.id ?? packState.currentPosition.nextRecommended
        });
        await refreshAdvice(false);
        await appendSystemMessage(`Execution run finished. ${getPrimaryAgentAdapter().label} summary:\n${result}`);
      } catch (error) {
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

  input.on("click", () => {
    input.focus();
    screen.render();
  });

  input.on("keypress", async (ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
    if (key.name === "pageup" || key.name === "ppage" || key.name === "pagedown" || key.name === "npage") {
      return;
    }

    if (key.name === "enter" && !key.shift && !key.meta && !key.ctrl) {
      await submitComposer();
      return;
    }

    if ((key.name === "enter" && (key.shift || key.meta)) || (key.ctrl && key.name === "j")) {
      composerValue += "\n";
      renderComposer();
      screen.render();
      return;
    }

    if (key.name === "backspace") {
      composerValue = removeLastCodePoint(composerValue);
      renderComposer();
      screen.render();
      return;
    }

    if (key.ctrl || key.meta) {
      return;
    }

    if (ch && !/^[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]$/.test(ch)) {
      composerValue += ch;
      renderComposer();
      screen.render();
    }
  });

  screen.key(["C-c"], () => {
    if (busyMode === "auto") {
      void requestAutoRunStop(workspace, { planId });
      return;
    }

    stopBusy();
    screen.destroy();
  });

  for (const element of [screen, transcript, input]) {
    element.key(["pageup", "ppage"], () => {
      scrollTranscript(-5);
    });

    element.key(["pagedown", "npage"], () => {
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
  const docsPresent = packState.docsPresent ?? (packState.packPresent ? 4 : 0);
  const lines = [
    `state: ${describePlanningPackState(packState)}`,
    `plan: ${planId}`,
    `dir: ${getPlanningPackPaths(workspace, { planId }).relativeDir}`,
    `docs: ${docsPresent}/4`,
    `readiness: ${readinessScore}/${readinessTotal}`
  ];

  const mode = deriveDisplayMode(packState);
  const readyToWrite = packState.readiness?.readyToWrite ?? false;

  if (mode === "Gathering Context" || mode === "Ready to Write") {
    lines.push(readyToWrite ? "next: /write will create or refresh the planning doc set" : "next: keep gathering context or run /readiness");
  } else if (mode === "Ready to Execute" || mode === "Execution Active" || mode === "Auto Running") {
    lines.push("next: /preview, /run, or /auto when ready");
  } else if (!packState.packPresent) {
    lines.push("next: /plan new <id> or /write to create the planning doc set");
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
    "",
    "Use `/workspace <path>` to switch repos.",
    "Use `/plans` to inspect plan directories and `/plan <id>` to switch plans.",
    !packState.packPresent || packState.mode === "Gathering Context" || packState.mode === "Ready to Write"
      ? "Use `/write` when you want to put the current plan on disk."
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
  const usages = getSupportedAgentAdapters().map((adapter) => `\`/agent ${adapter.id}\``);

  if (usages.length === 0) {
    return "Usage: `/agent <id>`";
  }

  if (usages.length === 1) {
    return `Usage: ${usages[0]}`;
  }

  if (usages.length === 2) {
    return `Usage: ${usages[0]} or ${usages[1]}`;
  }

  return `Usage: ${usages.slice(0, -1).join(", ")}, or ${usages[usages.length - 1]}`;
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
    `Docs: ${packState.docsPresent}/4`,
    `Readiness: ${packState.readiness.score}/${packState.readiness.total}${packState.readiness.readyToWrite ? " (ready to write)" : ""}`,
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
    packState.readiness.readyToWrite
      ? "Next: run `/write` to create or refresh the planning doc set."
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

function renderPlanUsageMessage(currentPlanId: string, paths: PlanningPackPaths): string {
  return [
    `Current plan: ${currentPlanId}`,
    `Planning dir: ${paths.relativeDir}`,
    "",
    "Commands:",
    "- `/plans` lists available plans",
    "- `/plan <id>` switches the active plan",
    "- `/plan new <id>` creates a named plan scaffold"
  ].join("\n");
}

async function renderPlansMessage(workspace: string, currentPlanId: string): Promise<string> {
  const refs = await listPlanningDirectories(workspace);

  if (refs.length === 0) {
    return "No planning packs exist yet.\nUse `/plan new <id>` or `/write` to create one.";
  }

  const states = await Promise.all(refs.map((ref) => readPlanningPackState(workspace, { planId: ref.planId })));

  return [
    "Plans:",
    ...states.map(
      (state) =>
        `- ${state.planId}${state.planId === currentPlanId ? " [active]" : ""}: ${state.packDir} | ${state.mode} | docs ${state.docsPresent}/4 | readiness ${state.readiness.score}/${state.readiness.total} | auto ${state.autoRun?.status ?? "idle"}`
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
