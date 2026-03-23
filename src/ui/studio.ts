import path from "node:path";
import blessed from "blessed";
import {
  getPrimaryAgentAdapter,
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
import { saveExecutionState } from "../core/execution-state";
import { readPlanningPackState, type PlanningCurrentPosition, type PlanningPackState } from "../core/planning-pack-state";
import type { ChatMessage } from "../core/prompts";
import { DEFAULT_STUDIO_MESSAGES, loadStoredActiveAgentId, loadStudioSession, saveStudioSession } from "../core/studio-session";
import {
  getPlanningPackPaths,
  readText,
  resolveWorkspace,
  type PlanningPackPaths
} from "../core/workspace";

type StudioOptions = {
  workspace?: string;
};

type BusyMode = "planner" | "pack" | "run";

const READY_FOOTER =
  " Enter send message   PgUp/PgDn scroll   /workspace switch repo   /agents tools   /write save plan   /preview safe preview   /run execute next step   /quit exit ";
const ACTIVITY_FRAMES = ["[    ]", "[=   ]", "[==  ]", "[=== ]", "[ ===]", "[  ==]", "[   =]"];

export async function launchStudio(options: StudioOptions = {}): Promise<void> {
  let workspace = resolveWorkspace(options.workspace);
  let messages = await loadStudioSession(workspace);
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
    height: "100%-7",
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
    height: "100%-7",
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

  const input = blessed.textbox({
    bottom: 1,
    left: 0,
    width: "100%",
    height: 3,
    inputOnFocus: true,
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

  function setSidebar(status?: string): void {
    const planningPaths = getPlanningPackPaths(workspace);

    sidebar.setContent(
      [
        "{bold}Workspace{/bold}",
        `root: ${workspace}`,
        `plan dir: ${planningPaths.dir}`,
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
        "{bold}Commands{/bold}",
        "/workspace [path]  inspect or switch planning view",
        "/agents  list supported tools and the current session choice",
        "/agent <id>  switch the active agent for this workspace",
        "/write  put the current plan on disk",
        "/preview  inspect the next execution without invoking the active agent",
        "/run    execute .srgical/04-next-agent-prompt.md",
        "/help   show the workflow and key controls",
        "/quit   close the studio",
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

  function scrollTranscript(lines: number): void {
    transcript.scroll(lines);
    screen.render();
  }

  async function appendMessage(message: ChatMessage): Promise<void> {
    messages.push(message);
    await saveStudioSession(workspace, messages);
  }

  async function refreshEnvironment(): Promise<void> {
    const [storedAgentId, packState] = await Promise.all([
      loadStoredActiveAgentId(workspace),
      readPlanningPackState(workspace)
    ]);
    let agentState = await resolvePrimaryAgent(workspace);

    if (!storedAgentId) {
      const availableAgents = agentState.statuses.filter((status) => status.available);

      if (availableAgents.length === 1) {
        agentState = await selectPrimaryAgent(workspace, availableAgents[0].id);
      }
    }

    latestPackState = packState;
    header.setContent(buildStudioHeaderContent(workspace, packState));
    agentSummary = formatAgentSummary(agentState.status, agentState.statuses);
    planningPackSummary = formatPlanningPackSummary(workspace, packState);
    trackerSummary = formatTrackerSummary(packState.currentPosition);
    executionSummary = formatExecutionSummary(packState.lastExecution);
    setSidebar();
    setFooter();
    renderTranscript();
    screen.render();
  }

  async function handleSlashCommand(command: string): Promise<void> {
    if (command === "/quit") {
      screen.destroy();
      return;
    }

    if (command === "/workspace") {
      const packState = latestPackState ?? (await readPlanningPackState(workspace));
      await appendMessage({
        role: "system",
        content: renderWorkspaceSelectionMessage(workspace, packState)
      });
      renderTranscript();
      setSidebar();
      setFooter();
      screen.render();
      return;
    }

    if (command.startsWith("/workspace")) {
      const requestedWorkspace = command.slice("/workspace".length).trim();

      if (!requestedWorkspace) {
        const packState = latestPackState ?? (await readPlanningPackState(workspace));
        await appendMessage({
          role: "system",
          content: renderWorkspaceSelectionMessage(workspace, packState)
        });
        renderTranscript();
        setSidebar();
        setFooter();
        screen.render();
        return;
      }

      const nextWorkspace = resolveStudioWorkspaceInput(workspace, requestedWorkspace);

      setSidebar("switching planning view...");
      setFooter(" Switching planning view... ");
      screen.render();

      workspace = nextWorkspace;
      messages = await loadStudioSession(workspace);
      await refreshEnvironment();

      await appendMessage({
        role: "system",
        content: [
          `Now looking at ${workspace}.`,
          "",
          renderWorkspaceSelectionMessage(workspace, latestPackState ?? (await readPlanningPackState(workspace)))
        ].join("\n")
      });
      renderTranscript();
      setSidebar();
      setFooter();
      screen.render();
      return;
    }

    if (command === "/agents") {
      const agentState = await resolvePrimaryAgent(workspace);
      await appendMessage({
        role: "system",
        content: renderAgentSelectionMessage(agentState.status, agentState.statuses)
      });
      renderTranscript();
      setSidebar();
      setFooter();
      screen.render();
      return;
    }

    if (command.startsWith("/agent")) {
      const requestedId = command.slice("/agent".length).trim().toLowerCase();

      if (!requestedId) {
        const agentState = await resolvePrimaryAgent(workspace);
        await appendMessage({
          role: "system",
          content: [
            "Usage: `/agent codex` or `/agent claude`",
            "",
            renderAgentSelectionMessage(agentState.status, agentState.statuses)
          ].join("\n")
        });
        renderTranscript();
        setSidebar();
        setFooter();
        screen.render();
        return;
      }

      setSidebar("updating active agent...");
      setFooter(" Updating active agent selection... ");
      screen.render();

      try {
        const agentState = await selectPrimaryAgent(workspace, requestedId);
        await appendMessage({
          role: "system",
          content: [
            `Active agent set to ${agentState.status.label} for this workspace session.`,
            "",
            renderAgentSelectionMessage(agentState.status, agentState.statuses)
          ].join("\n")
        });
      } catch (error) {
        await appendMessage({
          role: "system",
          content: `Agent selection failed: ${error instanceof Error ? error.message : String(error)}`
        });
      } finally {
        await refreshEnvironment();
      }

      return;
    }

    if (command === "/help") {
      await appendMessage({
        role: "system",
        content:
          [
            "Workflow:",
            "1. Talk normally to sharpen the plan against the real repo.",
            "2. Run `/workspace <path>` when you want to change which repo and planning directory you are looking at.",
            "3. Run `/agents` to inspect available tools and `/agent <id>` when you want to switch the workspace session.",
            "4. Run `/write` when the shape is ready to put the plan on disk inside `.srgical/`.",
            "5. Run `/preview` to inspect the next execution safely before writes happen.",
            "6. Run `/run` when you want the active agent to execute the next eligible tracker block.",
            "",
            "Controls:",
            "- `Enter` sends the current message.",
            "- `PageUp` and `PageDown` scroll the transcript.",
            "- `/quit` closes the studio."
          ].join("\n")
      });
      renderTranscript();
      setSidebar();
      setFooter();
      screen.render();
      return;
    }

    if (command === "/preview") {
      const paths: PlanningPackPaths = getPlanningPackPaths(workspace);
      const packState = await readPlanningPackState(workspace);

      if (!packState.packPresent) {
        await appendMessage({
          role: "system",
          content: "Execution preview unavailable: no .srgical planning pack was found yet."
        });
        renderTranscript();
        setSidebar();
        setFooter();
        screen.render();
        return;
      }

      const prompt = await readText(paths.nextPrompt);
      await appendMessage({
        role: "system",
        content: renderDryRunPreview(prompt, packState.nextStepSummary, packState.currentPosition.nextRecommended).join(
          "\n"
        )
      });
      renderTranscript();
      setSidebar();
      setFooter();
      screen.render();
      return;
    }

    if (command === "/write") {
      startBusy("pack");

      try {
        const result = await writePlanningPack(workspace, messages);
        await appendMessage({
          role: "system",
          content: `Planning pack updated. Summary:\n${result}`
        });
      } catch (error) {
        await appendMessage({
          role: "system",
          content: `Pack generation failed: ${error instanceof Error ? error.message : String(error)}`
        });
      } finally {
        stopBusy();
        await refreshEnvironment();
      }

      return;
    }

    if (command === "/run") {
      const paths: PlanningPackPaths = getPlanningPackPaths(workspace);
      const packState = await readPlanningPackState(workspace);

      if (!hasQueuedNextStep(packState.currentPosition.nextRecommended)) {
        await appendMessage({
          role: "system",
          content: formatNoQueuedNextStepMessage("studio")
        });
        renderTranscript();
        setSidebar();
        setFooter();
        screen.render();
        return;
      }

      startBusy("run");

      try {
        const prompt = await readText(paths.nextPrompt);
        const result = await runNextPrompt(workspace, prompt);
        await saveExecutionState(workspace, "success", "studio", result);
        await appendMessage({
          role: "system",
          content: `Execution run finished. ${getPrimaryAgentAdapter().label} summary:\n${result}`
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await saveExecutionState(workspace, "failure", "studio", message);
        const refreshedPackState = await readPlanningPackState(workspace);
        await appendMessage({
          role: "system",
          content: formatExecutionFailureMessage(
            message,
            refreshedPackState.nextStepSummary,
            refreshedPackState.currentPosition.nextRecommended,
            "studio"
          )
        });
      } finally {
        stopBusy();
        await refreshEnvironment();
      }

      return;
    }

    await appendMessage({
      role: "system",
      content: `Unknown command: ${command}`
    });
    renderTranscript();
    setSidebar();
    setFooter();
    screen.render();
  }

  input.on("submit", async (value: string) => {
    const text = value.trim();
    input.clearValue();

    if (!text || busy) {
      screen.render();
      return;
    }

    if (text.startsWith("/")) {
      await handleSlashCommand(text);
      input.focus();
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
    screen.render();

    try {
      const reply = await requestPlannerReply(workspace, messages);
      await appendMessage({
        role: "assistant",
        content: reply
      });
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
      input.focus();
      screen.render();
    }
  });

  screen.key(["C-c"], () => {
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
  setSidebar("booting...");
  setFooter(" Starting studio... ");
  screen.render();
  input.focus();
  await refreshEnvironment();
  await ensureFirstRunOrientation();

  async function ensureFirstRunOrientation(): Promise<void> {
    if (!latestPackState || !isDefaultStudioSession(messages)) {
      return;
    }

    await appendMessage({
      role: "system",
      content: renderWorkspaceSelectionMessage(workspace, latestPackState)
    });
    renderTranscript();
    setSidebar();
    setFooter();
    screen.render();
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
  const lines = [
    `state: ${describePlanningPackState(packState)}`,
    `dir: ${getPlanningPackPaths(workspace).dir}`
  ];

  if (!packState.packPresent) {
    lines.push("next: /write will put the plan on disk");
  } else if (packState.trackerReadable) {
    lines.push(packState.currentPosition.nextRecommended ? "next: /preview or /run when ready" : "next: plan is written; queue more work when ready");
  } else {
    lines.push("next: rewrite or repair the pack before running");
  }

  return lines.join("\n");
}

export function renderWorkspaceSelectionMessage(workspace: string, packState: PlanningPackState): string {
  return [
    "Planning view:",
    `- workspace: ${workspace}`,
    `- planning dir: ${getPlanningPackPaths(workspace).dir}`,
    `- plan status: ${describePlanningPackState(packState)}`,
    "",
    "Use `/workspace <path>` to switch repos.",
    !packState.packPresent
      ? "Use `/write` when you want to put the current plan on disk."
      : "Use `/write` when you want to refresh the plan on disk from this transcript."
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

  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(currentWorkspace, trimmed);
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
  if (!packState.packPresent) {
    return "not written yet";
  }

  if (!packState.trackerReadable) {
    return "written but needs attention";
  }

  return "written to disk";
}

function formatPlanningPackPill(packState: PlanningPackState): string {
  if (!packState.packPresent) {
    return "{#ffb14a-fg}PLAN NOT WRITTEN{/}";
  }

  if (!packState.trackerReadable) {
    return "{#ff7a59-fg}PACK NEEDS ATTENTION{/}";
  }

  return "{#4de2c5-fg}PLAN WRITTEN{/}";
}
