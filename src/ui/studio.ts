import path from "node:path";
import { readdir } from "node:fs/promises";
import blessed from "blessed";
import type { PlanningAdviceState } from "../core/advice-state";
import { dicePlanningPack, getPrimaryAgentAdapter, requestPlannerReply, resolvePrimaryAgent, runNextPrompt, writePlanningPack } from "../core/agent";
import { executeAutoRun, requestAutoRunStop } from "../core/auto-run";
import { readPackSnapshot } from "../core/change-summary";
import { appendExecutionLog, saveExecutionState } from "../core/execution-state";
import { formatExecutionFailureMessage, formatNoQueuedNextStepMessage, hasQueuedNextStep } from "../core/execution-controls";
import { buildExecutionIterationPrompt } from "../core/handoff";
import {
  DEFAULT_SLICE_PLAN_OPTIONS,
  parsePlanDiceIntent,
  renderPlanDiceHelp,
  renderPlanDiceLabel,
  type PlanDiceOptions
} from "../core/plan-dicing";
import { refreshPlanningAdvice } from "../core/planning-advice";
import { updatePlanManifest } from "../core/plan-manifest";
import { readPlanningPackState, type PlanningPackState } from "../core/planning-pack-state";
import { ensurePreparePack, recordVisibleChange, snapshotRevisionIfNeeded } from "../core/prepare-pack";
import { recordPlanningPackWrite, setHumanWriteConfirmation } from "../core/planning-state";
import { loadStudioSession, saveStudioSession } from "../core/studio-session";
import { loadStudioOperateConfig, saveStudioOperateConfig } from "../core/studio-operate-config";
import { unblockTrackerStep } from "../core/tracker-unblock";
import { fileExists, getPlanningPackPaths, readText, resolvePlanId, resolveWorkspace, saveActivePlanId } from "../core/workspace";

export type StudioMode = "prepare" | "operate";
type StudioOptions = { workspace?: string; planId?: string | null; mode?: StudioMode };
type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
type ScrollableElement = Pick<blessed.Widgets.ScrollableBoxElement, "height" | "iheight" | "getScroll" | "getScrollHeight" | "getScrollPerc" | "setScroll" | "setScrollPerc" | "scroll">;
type PositionedElement = { lpos?: { xi: number; xl: number; yi: number; yl: number } };
type StudioMouseOptions = { vt200Mouse: boolean; allMotion: boolean; sgrMouse: boolean; sendFocus: boolean };
type LiveStudioMessage = { append(chunk: string): void; finalize(content: string): Promise<void>; discard(): Promise<void> };
type StudioPalette = {
  headerFg: string;
  headerBg: string;
  panelBg: string;
  sidePanelBg: string;
  inputBg: string;
  footerFg: string;
  accent: string;
  transcriptBorder: string;
  scrollbarTrack: string;
  sidebarBorder: string;
  inputBorder: string;
  transcriptLabel: string;
  sidebarLabel: string;
  inputLabel: string;
};

const FILE_LIMIT = 6;
const SNIPPET_LIMIT = 1600;
const STUDIO_THEME = {
  headerFg: "#ecfeff",
  transcriptText: "#edf8ff",
  sidebarText: "#d8f3ff",
  userLabel: "#4ade80",
  aiLabel: "#fde047",
  systemLabel: "#60a5fa"
} as const;
const ESC = (blessed as typeof blessed & { helpers: { escape(text: string): string } }).helpers.escape;

export async function launchStudio(options: StudioOptions = {}): Promise<void> {
  let mode: StudioMode = options.mode === "operate" ? "operate" : "prepare";
  const workspace = resolveWorkspace(options.workspace);
  const planId = await resolvePlanId(workspace, options.planId).catch(async () => {
    if (mode === "prepare" && options.planId) {
      return options.planId!;
    }
    throw new Error("A named plan is required. Pass `<id>` or `--plan <id>`.");
  });

  await saveActivePlanId(workspace, planId);
  if (mode === "prepare") {
    await ensurePreparePack(workspace, { planId });
  }

  let messages = await loadStudioSession(workspace, { planId });
  let state = await readPlanningPackState(workspace, { planId });
  let agent = await resolvePrimaryAgent(workspace, { planId });
  let inputValue = "";
  let busy = false;
  let gatheredFingerprint = "";
  let transcriptWheelHandled = false;
  let lastTranscriptContent: string | null = null;
  const initialPalette = getStudioPalette(mode);

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, mouse: true, sendFocus: true, title: mode === "prepare" ? "srgical prepare" : "srgical operate" });
  const header = blessed.box({ top: 0, left: 0, width: "100%", height: 3, tags: true, style: { fg: STUDIO_THEME.headerFg, bg: initialPalette.headerBg } });
  const transcript = blessed.box({
    top: 3, left: 0, width: "68%", height: "100%-10", tags: true, scrollable: true, alwaysScroll: true, mouse: true, keys: true, vi: true, clickable: true, input: true,
    padding: { top: 1, right: 1, bottom: 1, left: 1 }, border: { type: "line" }, label: initialPalette.transcriptLabel,
    scrollbar: { ch: " ", track: { bg: initialPalette.scrollbarTrack }, style: { bg: initialPalette.transcriptBorder } },
    style: { fg: STUDIO_THEME.transcriptText, bg: initialPalette.panelBg, border: { fg: initialPalette.transcriptBorder } }
  });
  const sidebar = blessed.box({
    top: 3, left: "68%", width: "32%", height: "100%-10", tags: true,
    padding: { top: 1, right: 1, bottom: 1, left: 1 }, border: { type: "line" }, label: initialPalette.sidebarLabel,
    style: { fg: STUDIO_THEME.sidebarText, bg: initialPalette.sidePanelBg, border: { fg: initialPalette.sidebarBorder } }
  });
  const input = blessed.box({
    bottom: 1, left: 0, width: "100%", height: 6, tags: true, mouse: true, clickable: true, padding: { top: 0, right: 1, bottom: 0, left: 1 },
    border: { type: "line" }, label: initialPalette.inputLabel, style: { fg: STUDIO_THEME.transcriptText, bg: initialPalette.inputBg, border: { fg: initialPalette.inputBorder } }
  });
  const footer = blessed.box({ bottom: 0, left: 0, width: "100%", height: 1, tags: true, style: { fg: initialPalette.footerFg, bg: initialPalette.headerBg } });
  screen.append(header); screen.append(transcript); screen.append(sidebar); screen.append(input); screen.append(footer);
  screen.enableMouse(transcript);
  screen.enableMouse(input);
  screen.program.setMouse(getPreferredStudioMouseOptions(), true);

  const render = (status = "ready") => {
    const palette = getStudioPalette(mode);
    const transcriptContent = renderStudioTranscript(messages);
    const shouldStickTranscript = shouldStickScrollableToBottom(transcript);
    const transcriptScroll = transcript.getScroll();
    const transcriptChanged = transcriptContent !== lastTranscriptContent;
    const transcriptScrollbar = (transcript as blessed.Widgets.BoxElement & {
      scrollbar?: { track?: { bg?: string }; style?: { bg?: string } };
    }).scrollbar;

    header.style.bg = palette.headerBg;
    transcript.style.bg = palette.panelBg;
    transcript.style.border.fg = palette.transcriptBorder;
    if (transcriptScrollbar) {
      transcriptScrollbar.track = transcriptScrollbar.track ?? {};
      transcriptScrollbar.track.bg = palette.scrollbarTrack;
      transcriptScrollbar.style = transcriptScrollbar.style ?? {};
      transcriptScrollbar.style.bg = palette.transcriptBorder;
    }
    sidebar.style.bg = palette.sidePanelBg;
    sidebar.style.border.fg = palette.sidebarBorder;
    input.style.bg = palette.inputBg;
    input.style.border.fg = palette.inputBorder;
    footer.style.bg = palette.headerBg;
    footer.style.fg = palette.footerFg;
    transcript.setLabel(palette.transcriptLabel);
    sidebar.setLabel(palette.sidebarLabel);
    input.setLabel(palette.inputLabel);

    header.setContent(
      ` {bold}SRGICAL ${mode.toUpperCase()}{/bold}   ${path.basename(workspace) || workspace}   {${palette.accent}-fg}PLAN ${state.planId.toUpperCase()} | ${state.mode.toUpperCase()}{/}`
    );
    if (transcriptChanged) {
      transcript.setContent(transcriptContent);
      lastTranscriptContent = transcriptContent;
      if (!shouldStickTranscript) {
        transcript.setScroll(clampScrollableScrollPosition(transcriptScroll, transcript.getScrollHeight()));
      }
    }
    sidebar.setContent([
      "{bold}Overview{/bold}",
      `stage: ${state.mode}`,
      `next action: ${state.nextAction}`,
      `next step: ${state.currentPosition.nextRecommended ?? "none"}`,
      `approval: ${state.approvalStatus}`,
      "",
      "{bold}Evidence{/bold}",
      ...(state.evidence.length > 0 ? state.evidence.slice(0, 5).map((item) => `- ${item}`) : ["- none yet"]),
      "",
      "{bold}Unknowns{/bold}",
      ...(state.unknowns.length > 0 ? state.unknowns.slice(0, 5).map((item) => `- ${item}`) : ["- none recorded"]),
      "",
      "{bold}Last Change{/bold}",
      state.manifest?.lastChangeSummary ?? "none yet",
      "",
      "{bold}Runtime{/bold}",
      `agent: ${agent.status.label}`,
      `status: ${status}`,
      "",
      "{bold}Actions{/bold}",
      ...(mode === "prepare"
        ? ["F2 Gather More", "F3 Build Draft", "F4 Slice Plan", "F5 Review Changes", "F6 Approve Ready", "F7 Open Operate"]
        : ["F2 Run Next Step", "F3 Auto Continue", "F4 PR Checkpoints", "F5 Refine Plan", "F6 Review Last Change", "F7 Resolve Blocker"])
    ].join("\n"));
    input.setContent(renderStudioInputContent(inputValue));
    footer.setContent(busy
      ? " Working... "
      : mode === "prepare"
        ? " Text chats with planner | PgUp/PgDn/Home/End scroll transcript | :help | F2 Gather F3 Build F4 Slice F5 Review F6 Approve F7 Operate "
        : " Commands start with : | PgUp/PgDn/Home/End scroll transcript | :help | F2 Run F3 Auto F4 Checkpoint F5 Prepare F6 Review F7 Unblock ");
    const pinnedBeforeRender = transcriptChanged && shouldStickTranscript && tryStickScrollableToBottom(transcript);
    screen.render();
    if (transcriptChanged && shouldStickTranscript && !pinnedBeforeRender) {
      transcript.setScrollPerc(100);
      screen.render();
    }
  };

  const persistMessages = async () => { await saveStudioSession(workspace, messages, { planId }); };
  const refresh = async () => { state = await readPlanningPackState(workspace, { planId }); agent = await resolvePrimaryAgent(workspace, { planId }); render(); };
  const push = async (message: ChatMessage) => { messages.push(message); await persistMessages(); render(); };
  const system = async (content: string) => { await push({ role: "system", content }); };
  const scrollTranscriptBy = (offset: number) => { transcript.scroll(offset); screen.render(); };
  const scrollTranscriptByPage = (direction: -1 | 1) => { scrollTranscriptBy(direction * getScrollablePageStep(transcript)); };
  const scrollTranscriptTo = (target: "top" | "bottom") => {
    transcript.setScrollPerc(target === "top" ? 0 : 100);
    screen.render();
  };
  const startLiveMessage = (role: ChatMessage["role"], initialContent = ""): LiveStudioMessage => {
    const message: ChatMessage = { role, content: initialContent };
    messages.push(message);
    render();

    const remove = () => {
      const index = messages.indexOf(message);
      if (index >= 0) {
        messages.splice(index, 1);
      }
    };

    return {
      append(chunk: string) {
        const normalized = normalizeStudioStreamChunk(chunk);
        if (!normalized) return;
        message.content += normalized;
        render();
      },
      async finalize(content: string) {
        message.content = content.trim();
        if (!message.content) {
          remove();
        }
        await persistMessages();
        render();
      },
      async discard() {
        remove();
        await persistMessages();
        render();
      }
    };
  };

  const autoGather = async (origin: "boot" | "manual") => {
    if (busy) return;
    busy = true; render(origin === "boot" ? "auto-gathering..." : "gathering...");
    try {
      const files = await selectAutoGatherFiles(workspace);
      const fingerprint = files.join("|");
      if (origin === "boot" && fingerprint === gatheredFingerprint) { busy = false; render(); return; }
      gatheredFingerprint = fingerprint;
      for (const relativePath of files) {
        const body = await readText(path.join(workspace, relativePath)).catch(() => "");
        await system(`Loaded context file: ${relativePath}\n\n===== BEGIN FILE ${relativePath} =====\n${limitStudioSnippet(body.trim())}\n===== END FILE ${relativePath} =====`);
      }
      const adviceContext = [...messages];
      const liveAdvice = startLiveMessage("assistant");
      let advice: PlanningAdviceState | null = null;
      try {
        advice = await refreshPlanningAdvice(workspace, adviceContext, {
          planId,
          onOutputChunk: (chunk) => { liveAdvice.append(chunk); }
        });
        await liveAdvice.finalize(renderPlanningAdviceTranscript(advice));
      } catch {
        await liveAdvice.discard();
      }
      await updatePlanManifest(workspace, {
        stage: "discover",
        nextAction: advice?.nextAction ?? "Review the gathered evidence, then build the draft when you have enough context.",
        evidence: files,
        unknowns: advice?.researchNeeded ?? (state.unknowns.length > 0 ? state.unknowns : ["Desired outcome still needs a clean confirmation."]),
        contextReady: false
      }, { planId });
      await refresh();
      await system(`Auto-gather ${origin === "boot" ? "completed" : "updated"}.\nEvidence: ${files.join(", ")}\nUnknowns: ${state.unknowns.join(" | ") || "none"}\nNext action: ${state.nextAction}`);
    } catch (error) {
      await system(`Auto-gather failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false; render();
    }
  };

  const buildDraft = async () => {
    if (busy) return;
    if (!state.readiness.readyToWrite) { await system(`Build Draft is blocked.\nMissing: ${state.readiness.missingLabels.join(", ") || "none"}`); return; }
    busy = true; render("building draft...");
    let liveResult: LiveStudioMessage | null = null;
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const snapshot = await snapshotRevisionIfNeeded(workspace, { planId });
      const buildContext = [...messages];
      const activeLiveResult = liveResult = startLiveMessage("system", "Build Draft is running...\n\n");
      const result = await writePlanningPack(workspace, buildContext, {
        planId,
        onOutputChunk: (chunk) => { activeLiveResult.append(chunk); }
      });
      await recordPlanningPackWrite(workspace, "write", { planId });
      await refreshPlanningAdvice(workspace, messages, { planId }).catch(() => null);
      const headline = await recordVisibleChange(workspace, before, "Built or refreshed the prepare draft.", {
        planId, action: before.manifest ? "refine" : "prepare", stage: "Prepare",
        nextAction: "Review the draft, slice the plan if needed, then approve when it is clear enough to operate."
      });
      await refresh();
      await activeLiveResult.finalize(`Build Draft completed.\nRevision snapshot: ${snapshot ?? "none"}\nVisible change: ${headline}\n${getPrimaryAgentAdapter().label} summary:\n${result}`);
    } catch (error) {
      await liveResult?.discard();
      await system(`Build Draft failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false; render();
    }
  };

  const slicePlan = async (options: PlanDiceOptions = DEFAULT_SLICE_PLAN_OPTIONS, label = "Slice Plan") => {
    if (busy) return;
    if (!state.readiness.readyToDice) { await system("Slice Plan is blocked until a draft exists."); return; }
    busy = true; render("slicing plan...");
    let liveResult: LiveStudioMessage | null = null;
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const snapshot = await snapshotRevisionIfNeeded(workspace, { planId });
      const sliceContext = [...messages];
      const activeLiveResult = liveResult = startLiveMessage("system", `${label} is running...\n\n`);
      const result = await dicePlanningPack(workspace, sliceContext, options, {
        planId,
        onOutputChunk: (chunk) => { activeLiveResult.append(chunk); }
      });
      await recordPlanningPackWrite(workspace, "dice", { planId });
      const headline = await recordVisibleChange(workspace, before, "Sliced the draft into execution-ready steps.", {
        planId, action: "refine", stage: "Prepare", nextAction: "Review the sliced tracker, then approve when the next step is clear enough to operate."
      });
      await refresh();
      await activeLiveResult.finalize(`${label} completed.\nSettings: ${renderPlanDiceLabel(options)}\nRevision snapshot: ${snapshot ?? "none"}\nVisible change: ${headline}\n${getPrimaryAgentAdapter().label} summary:\n${result}`);
    } catch (error) {
      await liveResult?.discard();
      await system(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false; render();
    }
  };

  const approve = async () => {
    if (!state.readiness.readyToApprove) { await system("Approve Ready is blocked until a draft has been built or sliced."); return; }
    const before = await readPackSnapshot(workspace, { planId });
    await setHumanWriteConfirmation(workspace, true, { planId });
    await updatePlanManifest(workspace, { stage: "ready", approvedAt: new Date().toISOString(), contextReady: true }, { planId });
    const headline = await recordVisibleChange(workspace, before, "Approved the current draft for operate.", {
      planId, action: "refine", stage: "Ready", nextAction: "Open operate and run the next step."
    });
    await refresh(); await system(`Approve Ready completed.\nVisible change: ${headline}`);
  };

  const review = async () => {
    const paths = getPlanningPackPaths(workspace, { planId });
    await system([
      `Current stage: ${state.mode}`,
      `Next action: ${state.nextAction}`,
      `Last change: ${state.manifest?.lastChangeSummary ?? "none"}`,
      "",
      "changes.md",
      limitStudioSnippet((await readText(paths.changes).catch(() => "")).trim()),
      "",
      "manifest.json",
      limitStudioSnippet((await readText(paths.manifest).catch(() => "")).trim())
    ].join("\n"));
  };

  const runStep = async () => {
    if (busy) return;
    if (!hasQueuedNextStep(state.currentPosition.nextRecommended)) { await system(formatNoQueuedNextStepMessage("studio")); return; }
    if (state.approvalStatus !== "approved") { await system("Operate requires an approved draft. Switch to prepare and approve it first."); return; }
    busy = true; render("running next step...");
    let liveResult: LiveStudioMessage | null = null;
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const prompt = await buildExecutionIterationPrompt(workspace, state, { planId });
      const activeLiveResult = liveResult = startLiveMessage("system", "Run next step is executing...\n\n");
      const result = await runNextPrompt(workspace, prompt.prompt, {
        planId,
        onOutputChunk: (chunk) => { activeLiveResult.append(chunk); }
      });
      await saveExecutionState(workspace, "success", "studio", result, { planId });
      await appendExecutionLog(workspace, "success", "studio", result, { planId, stepLabel: state.nextStepSummary?.id ?? state.currentPosition.nextRecommended });
      await refresh();
      const stage = state.mode === "Blocked" ? "Blocked" : state.currentPosition.nextRecommended ? "Execute" : "Finished";
      const headline = await recordVisibleChange(workspace, before, "Executed one operate step.", {
        planId, action: "operate", stage,
        nextAction: stage === "Blocked" ? "Resolve the blocker or reopen prepare." : stage === "Finished" ? "Review the outcome or reopen prepare to extend the plan." : "Run the next step or switch on auto continue."
      });
      await refresh();
      await activeLiveResult.finalize(`Run next step completed.\nPrompt source: ${prompt.handoffDoc.displayPath}\nVisible change: ${headline}\n${getPrimaryAgentAdapter().label} summary:\n${result}`);
    } catch (error) {
      await liveResult?.discard();
      const message = error instanceof Error ? error.message : String(error);
      await saveExecutionState(workspace, "failure", "studio", message, { planId });
      await appendExecutionLog(workspace, "failure", "studio", message, { planId, stepLabel: state.nextStepSummary?.id ?? state.currentPosition.nextRecommended });
      await refresh();
      await system(formatExecutionFailureMessage(message, state.nextStepSummary, state.currentPosition.nextRecommended, "studio"));
    } finally {
      busy = false; render();
    }
  };

  const autoContinue = async (maxSteps?: number) => {
    if (busy) return;
    busy = true; render("auto continuing...");
    let liveResult: LiveStudioMessage | null = null;
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const activeLiveResult = liveResult = startLiveMessage("system", "Auto continue is running...\n\n");
      const result = await executeAutoRun(workspace, {
        source: "studio",
        planId,
        maxSteps,
        onMessage: async (line) => { activeLiveResult.append(`${line}\n`); },
        onOutputChunk: (chunk) => { activeLiveResult.append(chunk); }
      });
      await refresh();
      const headline = await recordVisibleChange(workspace, before, "Auto continue ran one or more operate steps.", {
        planId, action: "operate", stage: state.mode, nextAction: state.nextAction, executionMode: "auto"
      });
      await refresh();
      await activeLiveResult.finalize(`Auto continue finished: ${result.summary}\nVisible change: ${headline}`);
    } catch (error) {
      await liveResult?.discard();
      await system(`Auto continue failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false; render();
    }
  };

  const toggleCheckpoint = async () => {
    const config = await loadStudioOperateConfig(workspace, { planId });
    const updated = await saveStudioOperateConfig(workspace, { pauseForPr: !config.pauseForPr }, { planId });
    await updatePlanManifest(workspace, { executionMode: updated.pauseForPr ? "checkpoint" : "step" }, { planId });
    await refresh(); await system(`Checkpoint mode ${updated.pauseForPr ? "enabled" : "disabled"}.`);
  };

  const resolveBlocker = async () => {
    const before = await readPackSnapshot(workspace, { planId });
    try {
      const result = await unblockTrackerStep(workspace, { planId, requestedStepId: state.currentPosition.nextRecommended ?? undefined });
      const headline = await recordVisibleChange(workspace, before, "Resolved a blocker and re-queued the next step.", {
        planId, action: "operate", stage: "Ready", nextAction: "Run the next step again now that it has been re-queued."
      });
      await refresh(); await system(`Blocker resolved for \`${result.stepId}\`.\nVisible change: ${headline}`);
    } catch (error) {
      await system(`Resolve blocker failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleCommand = async (command: string) => {
    if (command === ":quit" || command === ":q") { screen.destroy(); return; }
    if (command === ":command" || command.startsWith(":command ")) {
      await system("`:` is only the command prefix.\nUse commands like `:help`, `:slice --help`, `:gather`, or `:operate`.\nIf you want to chat with the planner, just type normal text without the `:`.");
      return;
    }
    if (command === ":help" || command === ":help prepare" || command === ":help operate") {
      await system(mode === "prepare" ? renderPrepareHelpText() : renderOperateHelpText());
      return;
    }
    if (command === ":help commands") {
      await system(renderCommandSyntaxHelpText(mode));
      return;
    }
    if (command === ":help slice" || command === ":help dice") { await system(renderPlanDiceHelp(":slice")); return; }
    if (command === ":status") { await system(`Mode: ${mode}\nStage: ${state.mode}\nNext action: ${state.nextAction}\nNext step: ${state.currentPosition.nextRecommended ?? "none"}`); return; }
    if (command === ":prepare") { mode = "prepare"; screen.title = "srgical prepare"; await refresh(); return; }
    if (command === ":operate") { mode = "operate"; screen.title = "srgical operate"; await refresh(); return; }
    if (command === ":gather") { await autoGather("manual"); return; }
    if (command === ":build") { await buildDraft(); return; }
    if (command.startsWith(":slice")) {
      const intent = parsePlanDiceIntent(command);
      if (!intent || intent.command !== ":slice") {
        await system("Unrecognized slice command.\n\n" + renderPlanDiceHelp(":slice"));
        return;
      }
      if (intent.helpRequested) { await system(renderPlanDiceHelp(":slice")); return; }
      await slicePlan(intent.options, "Slice Plan");
      return;
    }
    if (command === ":approve") { await approve(); return; }
    if (command === ":review") { await review(); return; }
    if (command === ":run") { await runStep(); return; }
    if (command.startsWith(":auto")) { const raw = command.slice(":auto".length).trim(); const max = raw ? Number(raw) : undefined; await autoContinue(Number.isFinite(max) ? max : undefined); return; }
    if (command === ":checkpoint") { await toggleCheckpoint(); return; }
    if (command === ":unblock") { await resolveBlocker(); return; }
    if (command === ":stop") { const result = await requestAutoRunStop(workspace, { planId }); await system(result.stopReason ?? "Stop requested."); await refresh(); return; }
    await system(`Unknown command: ${command}\nTry \`:help\` to list commands or \`:help commands\` for the quick command syntax explanation.`);
  };

  const submit = async () => {
    const text = inputValue.trim();
    inputValue = ""; render();
    if (!text) return;
    if (text.startsWith(":")) { await push({ role: "system", content: `Command: ${text}` }); await handleCommand(text); return; }
    const diceIntent = parsePlanDiceIntent(text);
    if (diceIntent) {
      await push({ role: "system", content: `Command: ${text}` });
      if (mode !== "prepare") {
        await system("Slicing is only available in prepare mode. Switch back to prepare first.");
        return;
      }
      if (diceIntent.helpRequested) {
        await system(renderPlanDiceHelp(diceIntent.command));
        return;
      }
      await slicePlan(
        diceIntent.options,
        diceIntent.command === "/dice" ? "Legacy /dice compatibility slice" : "Slice Plan"
      );
      return;
    }
    if (text === "/help") {
      await push({ role: "system", content: "Command: /help" });
      await system(mode === "prepare" ? renderPrepareHelpText() : renderOperateHelpText());
      return;
    }
    if (text.startsWith("/")) {
      await push({ role: "system", content: `Command: ${text}` });
      await system("Slash commands were retired in the rebooted studio.\nUse `:` commands now, for example `:help`, `:gather`, `:slice --help`, or `:operate`.\nIf you just want to chat with the planner, type plain text without a prefix.");
      return;
    }
    if (mode === "operate") { await system("Operate is action-first. Use the primary actions or the :command palette."); return; }
    busy = true; render("thinking...");
    let liveReply: LiveStudioMessage | null = null;
    try {
      await push({ role: "user", content: text });
      const plannerContext = [...messages];
      const activeLiveReply = liveReply = startLiveMessage("assistant");
      const reply = await requestPlannerReply(workspace, plannerContext, {
        planId,
        onOutputChunk: (chunk) => { activeLiveReply.append(chunk); }
      });
      await activeLiveReply.finalize(reply.trim());
      await refreshPlanningAdvice(workspace, messages, { planId }).catch(() => null);
      await refresh();
    } catch (error) {
      await liveReply?.discard();
      await system(`Planner request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false; render();
    }
  };

  screen.key(["C-c"], () => screen.destroy());
  screen.key(["f1"], async () => { await handleCommand(":help"); });
  screen.key(["f2"], async () => { mode === "prepare" ? await autoGather("manual") : await runStep(); });
  screen.key(["f3"], async () => { mode === "prepare" ? await buildDraft() : await autoContinue(); });
  screen.key(["f4"], async () => { mode === "prepare" ? await slicePlan() : await toggleCheckpoint(); });
  screen.key(["f5"], async () => { if (mode === "prepare") { await review(); } else { mode = "prepare"; screen.title = "srgical prepare"; await refresh(); } });
  screen.key(["f6"], async () => { mode === "prepare" ? await approve() : await review(); });
  screen.key(["f7"], async () => { if (mode === "prepare") { mode = "operate"; screen.title = "srgical operate"; await refresh(); } else { await resolveBlocker(); } });
  transcript.on("wheelup", () => { transcriptWheelHandled = true; });
  transcript.on("wheeldown", () => { transcriptWheelHandled = true; });
  screen.on("wheelup", (data) => {
    if (!isMouseWithinElement(transcript, data)) return;
    if (transcriptWheelHandled) {
      transcriptWheelHandled = false;
      return;
    }
    scrollTranscriptBy(-3);
  });
  screen.on("wheeldown", (data) => {
    if (!isMouseWithinElement(transcript, data)) return;
    if (transcriptWheelHandled) {
      transcriptWheelHandled = false;
      return;
    }
    scrollTranscriptBy(3);
  });
  transcript.on("click", () => { transcript.focus(); });
  input.on("click", () => { input.focus(); });
  transcript.on("keypress", (_ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
    handleTranscriptNavigationKey(key, scrollTranscriptByPage, scrollTranscriptTo);
  });
  input.on("keypress", async (ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
    if (handleTranscriptNavigationKey(key, scrollTranscriptByPage, scrollTranscriptTo)) return;
    if (key.name === "enter") { await submit(); return; }
    if (key.name === "backspace") { inputValue = inputValue.slice(0, -1); render(); return; }
    if (key.name === "escape") { inputValue = ""; render(); return; }
    if (ch && !key.ctrl && !key.meta) { inputValue += ch; render(); }
  });

  await system(mode === "prepare"
    ? `Prepare mode gathers context, builds the draft, slices it into steps, and gets the plan ready to operate.\nType normal text to chat with the planner.\nUse \`:\` to run a studio command such as \`:help\`, \`:build\`, \`:slice --help\`, or \`:operate\`.\nStage: ${state.mode}\nNext action: ${state.nextAction}`
    : `Operate mode is execution-only.\nUse \`:\` to run studio commands such as \`:run\`, \`:auto 3\`, \`:checkpoint\`, or \`:prepare\`.\nStage: ${state.mode}\nNext action: ${state.nextAction}`);
  render();
  if (mode === "prepare") { await autoGather("boot"); }
  input.focus();
}

export async function selectAutoGatherFiles(workspaceRoot: string): Promise<string[]> {
  const preferred = ["package.json", "README.md", "docs/product-foundation.md"];
  const preferredExisting = (
    await Promise.all(
      preferred.map(async (relativePath) => ((await fileExists(path.join(workspaceRoot, relativePath))) ? relativePath : null))
    )
  ).filter((value): value is string => Boolean(value));
  const files = [
    ...preferredExisting,
    ...(await collect(path.join(workspaceRoot, "src"), workspaceRoot, FILE_LIMIT)),
    ...(await collect(path.join(workspaceRoot, "test"), workspaceRoot, FILE_LIMIT))
  ];
  return Array.from(new Set(files)).slice(0, FILE_LIMIT);
}

async function collect(dir: string, root: string, limit: number): Promise<string[]> {
  try {
    const out: string[] = [];
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= limit) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { out.push(...(await collect(full, root, limit - out.length))); continue; }
      out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
    return out;
  } catch {
    return [];
  }
}

export function limitStudioSnippet(value: string): string {
  return value.length <= SNIPPET_LIMIT ? value : `${value.slice(0, SNIPPET_LIMIT).trimEnd()}\n... [truncated after ${SNIPPET_LIMIT} chars]`;
}

export function renderStudioInputContent(value: string): string {
  return ESC(value).replace(/ /g, "\u00a0");
}

export function renderStudioTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? `{${STUDIO_THEME.userLabel}-fg}YOU{/}` : m.role === "assistant" ? `{${STUDIO_THEME.aiLabel}-fg}AI{/}` : `{${STUDIO_THEME.systemLabel}-fg}SYSTEM{/}`}\n${ESC(m.content)}`)
    .join("\n\n");
}

export function normalizeStudioStreamChunk(chunk: string): string {
  return chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function renderPlanningAdviceTranscript(advice: Pick<PlanningAdviceState, "problemStatement" | "clarity" | "stateAssessment" | "researchNeeded" | "advice" | "nextAction">): string {
  return [
    "Gathered context review.",
    `Problem: ${advice.problemStatement}`,
    `Clarity: ${advice.clarity}`,
    "",
    "Assessment:",
    advice.stateAssessment,
    "",
    "Advice:",
    advice.advice,
    ...(advice.researchNeeded.length > 0
      ? ["", "Research needed:", ...advice.researchNeeded.map((item) => `- ${item}`)]
      : []),
    "",
    `Next action: ${advice.nextAction}`
  ].join("\n");
}

export function shouldStickScrollableToBottom(element: Pick<ScrollableElement, "height" | "iheight" | "getScrollHeight" | "getScrollPerc">): boolean {
  const viewportHeight = getScrollableViewportHeight(element);
  if (viewportHeight <= 0) return true;
  if (element.getScrollHeight() <= viewportHeight) return true;
  return element.getScrollPerc() >= 99;
}

export function getScrollablePageStep(element: Pick<ScrollableElement, "height" | "iheight">): number {
  return Math.max(getScrollableViewportHeight(element) - 1, 1);
}

export function getPreferredStudioMouseOptions(): StudioMouseOptions {
  return {
    vt200Mouse: true,
    allMotion: true,
    sgrMouse: true,
    sendFocus: true
  };
}

export function getStudioPalette(mode: StudioMode): StudioPalette {
  return mode === "prepare"
    ? {
        headerFg: STUDIO_THEME.headerFg,
        headerBg: "#061711",
        panelBg: "#07140f",
        sidePanelBg: "#0b1d16",
        inputBg: "#0f2119",
        footerFg: "#99f6e4",
        accent: "#2dd4bf",
        transcriptBorder: "#14b8a6",
        scrollbarTrack: "#10261f",
        sidebarBorder: "#22c55e",
        inputBorder: "#5eead4",
        transcriptLabel: " Prepare Transcript ",
        sidebarLabel: " Prepare Control ",
        inputLabel: " Plan Message or :command "
      }
    : {
        headerFg: STUDIO_THEME.headerFg,
        headerBg: "#081424",
        panelBg: "#081220",
        sidePanelBg: "#0c1829",
        inputBg: "#101d31",
        footerFg: "#93c5fd",
        accent: "#60a5fa",
        transcriptBorder: "#3b82f6",
        scrollbarTrack: "#13243b",
        sidebarBorder: "#38bdf8",
        inputBorder: "#60a5fa",
        transcriptLabel: " Operate Transcript ",
        sidebarLabel: " Operate Control ",
        inputLabel: " Operate Commands (:help) "
      };
}

export function clampScrollableScrollPosition(scroll: number, scrollHeight: number): number {
  return Math.max(0, Math.min(scroll, Math.max(scrollHeight - 1, 0)));
}

export function handleTranscriptNavigationKey(
  key: Pick<blessed.Widgets.Events.IKeyEventArg, "name">,
  scrollByPage: (direction: -1 | 1) => void,
  scrollTo: (target: "top" | "bottom") => void
): boolean {
  if (key.name === "pageup") {
    scrollByPage(-1);
    return true;
  }
  if (key.name === "pagedown") {
    scrollByPage(1);
    return true;
  }
  if (key.name === "home") {
    scrollTo("top");
    return true;
  }
  if (key.name === "end") {
    scrollTo("bottom");
    return true;
  }
  return false;
}

function tryStickScrollableToBottom(element: ScrollableElement): boolean {
  const viewportHeight = getScrollableViewportHeight(element);
  if (viewportHeight <= 0) return false;
  element.setScrollPerc(100);
  return true;
}

function getScrollableViewportHeight(element: Pick<ScrollableElement, "height" | "iheight">): number {
  const height = typeof element.height === "number" ? element.height : Number(element.height);
  const innerHeight = typeof element.iheight === "number" ? element.iheight : Number(element.iheight);
  if (!Number.isFinite(height) || !Number.isFinite(innerHeight)) return 0;
  return Math.max(height - innerHeight, 0);
}

function isMouseWithinElement(
  element: blessed.Widgets.BoxElement,
  data: blessed.Widgets.Events.IMouseEventArg
): boolean {
  const pos = (element as blessed.Widgets.BoxElement & PositionedElement).lpos;
  if (!pos) return false;
  return data.x >= pos.xi && data.x < pos.xl && data.y >= pos.yi && data.y < pos.yl;
}

export function renderPrepareHelpText(): string {
  return [
    "Prepare commands:",
    "- Plain text without a prefix is normal planning chat.",
    "- Commands start with `:`. Example: `:help`, `:build`, `:slice high spike`, `:operate`.",
    "- `:gather`: run another evidence pass and refresh the known unknowns.",
    "- `:build`: write or refresh the current draft from transcript context and repo evidence.",
    "- `:slice`: slice the current draft using the recommended preset (`high + spike`).",
    "- `:slice [low|medium|high] [spike]`: override slice settings for this run.",
    "- `:slice --help`: show the slice arguments, defaults, and examples.",
    "- `/dice ...`: legacy compatibility alias for slicing; `/dice --help` shows the same option guide with legacy defaults.",
    "- `:help commands`: explain the `:` command syntax quickly.",
    "- `:review`: show the current changes log and manifest snapshot.",
    "- `:approve`: mark the current draft ready for operate.",
    "- `:operate`: switch to operate mode.",
    "- `:status`: show the current stage, next action, and next step.",
    "- `:quit`: exit studio."
  ].join("\n");
}

export function renderOperateHelpText(): string {
  return [
    "Operate commands:",
    "- Plain text chat is disabled here so execution stays action-first.",
    "- Commands start with `:`. Example: `:run`, `:auto 3`, `:checkpoint`, `:prepare`.",
    "- `:run`: execute the next queued step once.",
    "- `:auto [n]`: continue automatically for up to `n` steps, or the remaining queue when `n` is omitted.",
    "- `:checkpoint`: toggle PR checkpoint mode on or off.",
    "- `:review`: show the latest visible change summary and manifest snapshot.",
    "- `:unblock`: move the current blocked step back to `todo` with retry notes.",
    "- `:help commands`: explain the `:` command syntax quickly.",
    "- `:prepare`: switch back to prepare mode to refine the plan.",
    "- `:status`: show the current stage, next action, and next step.",
    "- `:stop`: request stop for an active auto-continue run.",
    "- `:quit`: exit studio."
  ].join("\n");
}

export function renderCommandSyntaxHelpText(mode: StudioMode): string {
  return [
    "Command syntax:",
    "- `:` is just the command prefix. There is no literal `:command` command.",
    mode === "prepare"
      ? "- In prepare, plain text is normal chat with the planner."
      : "- In operate, plain text chat is disabled so commands stay explicit.",
    "- Examples: `:help`, `:slice --help`, `:build`, `:run`, `:auto 3`.",
    "- Old slash commands are retired. Use `:` commands instead. `/dice` and `/help` still work as compatibility shortcuts."
  ].join("\n");
}
