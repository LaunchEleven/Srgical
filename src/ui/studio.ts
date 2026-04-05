import path from "node:path";
import { readdir } from "node:fs/promises";
import blessed from "blessed";
import { dicePlanningPack, getPrimaryAgentAdapter, requestPlannerReply, resolvePrimaryAgent, runNextPrompt, writePlanningPack } from "../core/agent";
import { executeAutoRun, requestAutoRunStop } from "../core/auto-run";
import { readPackSnapshot } from "../core/change-summary";
import { appendExecutionLog, saveExecutionState } from "../core/execution-state";
import { formatExecutionFailureMessage, formatNoQueuedNextStepMessage, hasQueuedNextStep } from "../core/execution-controls";
import { buildExecutionIterationPrompt } from "../core/handoff";
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

const FILE_LIMIT = 6;
const SNIPPET_LIMIT = 1600;
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

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, mouse: true, title: mode === "prepare" ? "srgical prepare" : "srgical operate" });
  const header = blessed.box({ top: 0, left: 0, width: "100%", height: 3, tags: true, style: { fg: "#f7efe6", bg: "#15171d" } });
  const transcript = blessed.box({
    top: 3, left: 0, width: "68%", height: "100%-10", tags: true, scrollable: true, alwaysScroll: true, mouse: true,
    padding: { top: 1, right: 1, bottom: 1, left: 1 }, border: { type: "line" }, label: " Transcript ",
    style: { fg: "#fff7ed", bg: "#101114", border: { fg: "#ff7a59" } }
  });
  const sidebar = blessed.box({
    top: 3, left: "68%", width: "32%", height: "100%-10", tags: true,
    padding: { top: 1, right: 1, bottom: 1, left: 1 }, border: { type: "line" }, label: " Control ",
    style: { fg: "#d8fff5", bg: "#11161c", border: { fg: "#4de2c5" } }
  });
  const input = blessed.box({
    bottom: 1, left: 0, width: "100%", height: 6, tags: true, padding: { top: 0, right: 1, bottom: 0, left: 1 },
    border: { type: "line" }, label: " Message / :command ", style: { fg: "#fff8ef", bg: "#1a1112", border: { fg: "#ffb14a" } }
  });
  const footer = blessed.box({ bottom: 0, left: 0, width: "100%", height: 1, tags: true, style: { fg: "#bfb8c7", bg: "#15171d" } });
  screen.append(header); screen.append(transcript); screen.append(sidebar); screen.append(input); screen.append(footer);

  const render = (status = "ready") => {
    header.setContent(` {bold}SRGICAL ${mode.toUpperCase()}{/bold}   ${path.basename(workspace) || workspace}   {${mode === "prepare" ? "#ffb14a-fg" : "#4de2c5-fg"}}PLAN ${state.planId.toUpperCase()} | ${state.mode.toUpperCase()}{/}`);
    transcript.setContent(messages.map((m) => `${m.role === "user" ? "{#ffb14a-fg}YOU{/}" : m.role === "assistant" ? "{#4de2c5-fg}AI{/}" : "{#ff7a59-fg}SYSTEM{/}"}\n${ESC(m.content)}`).join("\n\n"));
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
    input.setContent(`${ESC(inputValue)}{#ffb14a-fg}_{/}`);
    footer.setContent(busy
      ? " Working... "
      : mode === "prepare"
        ? " F2 Gather   F3 Build   F4 Slice   F5 Review   F6 Approve   F7 Operate   :help "
        : " F2 Run   F3 Auto   F4 Checkpoint   F5 Refine   F6 Review   F7 Unblock   :help ");
    screen.render();
  };

  const refresh = async () => { state = await readPlanningPackState(workspace, { planId }); agent = await resolvePrimaryAgent(workspace, { planId }); render(); };
  const push = async (message: ChatMessage) => { messages.push(message); await saveStudioSession(workspace, messages, { planId }); render(); };
  const system = async (content: string) => { await push({ role: "system", content }); };

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
      const advice = await refreshPlanningAdvice(workspace, messages, { planId }).catch(() => null);
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
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const snapshot = await snapshotRevisionIfNeeded(workspace, { planId });
      const result = await writePlanningPack(workspace, messages, { planId });
      await recordPlanningPackWrite(workspace, "write", { planId });
      await refreshPlanningAdvice(workspace, messages, { planId }).catch(() => null);
      const headline = await recordVisibleChange(workspace, before, "Built or refreshed the prepare draft.", {
        planId, action: before.manifest ? "refine" : "prepare", stage: "Prepare",
        nextAction: "Review the draft, slice the plan if needed, then approve when it is clear enough to operate."
      });
      await refresh();
      await system(`Build Draft completed.\nRevision snapshot: ${snapshot ?? "none"}\nVisible change: ${headline}\n${getPrimaryAgentAdapter().label} summary:\n${result}`);
    } catch (error) {
      await system(`Build Draft failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false; render();
    }
  };

  const slicePlan = async () => {
    if (busy) return;
    if (!state.readiness.readyToDice) { await system("Slice Plan is blocked until a draft exists."); return; }
    busy = true; render("slicing plan...");
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const snapshot = await snapshotRevisionIfNeeded(workspace, { planId });
      const result = await dicePlanningPack(workspace, messages, { resolution: "high", allowLiveFireSpike: true }, { planId });
      await recordPlanningPackWrite(workspace, "dice", { planId });
      const headline = await recordVisibleChange(workspace, before, "Sliced the draft into execution-ready steps.", {
        planId, action: "refine", stage: "Prepare", nextAction: "Review the sliced tracker, then approve when the next step is clear enough to operate."
      });
      await refresh();
      await system(`Slice Plan completed.\nRevision snapshot: ${snapshot ?? "none"}\nVisible change: ${headline}\n${getPrimaryAgentAdapter().label} summary:\n${result}`);
    } catch (error) {
      await system(`Slice Plan failed: ${error instanceof Error ? error.message : String(error)}`);
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
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const prompt = await buildExecutionIterationPrompt(workspace, state, { planId });
      const result = await runNextPrompt(workspace, prompt.prompt, { planId });
      await saveExecutionState(workspace, "success", "studio", result, { planId });
      await appendExecutionLog(workspace, "success", "studio", result, { planId, stepLabel: state.nextStepSummary?.id ?? state.currentPosition.nextRecommended });
      await refresh();
      const stage = state.mode === "Blocked" ? "Blocked" : state.currentPosition.nextRecommended ? "Execute" : "Finished";
      const headline = await recordVisibleChange(workspace, before, "Executed one operate step.", {
        planId, action: "operate", stage,
        nextAction: stage === "Blocked" ? "Resolve the blocker or reopen prepare." : stage === "Finished" ? "Review the outcome or reopen prepare to extend the plan." : "Run the next step or switch on auto continue."
      });
      await refresh();
      await system(`Run next step completed.\nPrompt source: ${prompt.handoffDoc.displayPath}\nVisible change: ${headline}\n${getPrimaryAgentAdapter().label} summary:\n${result}`);
    } catch (error) {
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
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const result = await executeAutoRun(workspace, { source: "studio", planId, maxSteps });
      await refresh();
      const headline = await recordVisibleChange(workspace, before, "Auto continue ran one or more operate steps.", {
        planId, action: "operate", stage: state.mode, nextAction: state.nextAction, executionMode: "auto"
      });
      await refresh(); await system(`Auto continue finished: ${result.summary}\nVisible change: ${headline}`);
    } catch (error) {
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
    if (command === ":help") { await system(mode === "prepare" ? "Commands: :gather, :build, :slice, :review, :approve, :operate, :status, :quit" : "Commands: :run, :auto [n], :checkpoint, :review, :unblock, :prepare, :stop, :status, :quit"); return; }
    if (command === ":status") { await system(`Mode: ${mode}\nStage: ${state.mode}\nNext action: ${state.nextAction}\nNext step: ${state.currentPosition.nextRecommended ?? "none"}`); return; }
    if (command === ":prepare") { mode = "prepare"; screen.title = "srgical prepare"; await refresh(); return; }
    if (command === ":operate") { mode = "operate"; screen.title = "srgical operate"; await refresh(); return; }
    if (command === ":gather") { await autoGather("manual"); return; }
    if (command === ":build") { await buildDraft(); return; }
    if (command.startsWith(":slice")) { await slicePlan(); return; }
    if (command === ":approve") { await approve(); return; }
    if (command === ":review") { await review(); return; }
    if (command === ":run") { await runStep(); return; }
    if (command.startsWith(":auto")) { const raw = command.slice(":auto".length).trim(); const max = raw ? Number(raw) : undefined; await autoContinue(Number.isFinite(max) ? max : undefined); return; }
    if (command === ":checkpoint") { await toggleCheckpoint(); return; }
    if (command === ":unblock") { await resolveBlocker(); return; }
    if (command === ":stop") { const result = await requestAutoRunStop(workspace, { planId }); await system(result.stopReason ?? "Stop requested."); await refresh(); return; }
    await system(`Unknown command: ${command}`);
  };

  const submit = async () => {
    const text = inputValue.trim();
    inputValue = ""; render();
    if (!text) return;
    if (text.startsWith(":")) { await push({ role: "system", content: `Command: ${text}` }); await handleCommand(text); return; }
    if (mode === "operate") { await system("Operate is action-first. Use the primary actions or the :command palette."); return; }
    busy = true; render("thinking...");
    try {
      await push({ role: "user", content: text });
      const reply = await requestPlannerReply(workspace, messages, { planId });
      await push({ role: "assistant", content: reply.trim() });
      await refreshPlanningAdvice(workspace, messages, { planId }).catch(() => null);
      await refresh();
    } catch (error) {
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
  input.on("keypress", async (ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
    if (key.name === "enter") { await submit(); return; }
    if (key.name === "backspace") { inputValue = inputValue.slice(0, -1); render(); return; }
    if (key.name === "escape") { inputValue = ""; render(); return; }
    if (ch && !key.ctrl && !key.meta) { inputValue += ch; render(); }
  });

  await system(mode === "prepare"
    ? `Prepare mode gathers context, builds the draft, slices it into steps, and gets the plan ready to operate.\nStage: ${state.mode}\nNext action: ${state.nextAction}`
    : `Operate mode is execution-only.\nStage: ${state.mode}\nNext action: ${state.nextAction}`);
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
