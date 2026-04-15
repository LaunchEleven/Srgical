import path from "node:path";
import {
  DEFAULT_SLICE_PLAN_OPTIONS,
  parsePlanDiceIntent,
  renderPlanDiceHelp,
  renderPlanDiceLabel,
  type PlanDiceOptions
} from "../../../apps/cli/src/core/plan-dicing";
import {
  dicePlanningPack,
  getPrimaryAgentAdapter,
  requestPlannerReply,
  resolvePrimaryAgent,
  runNextPrompt,
  writePlanningPack
} from "../../../apps/cli/src/core/agent";
import { executeAutoRun, requestAutoRunStop } from "../../../apps/cli/src/core/auto-run";
import { readPackSnapshot } from "../../../apps/cli/src/core/change-summary";
import { syncPlanningContext } from "../../../apps/cli/src/core/context-refresh";
import { appendExecutionLog, saveExecutionState } from "../../../apps/cli/src/core/execution-state";
import { formatExecutionFailureMessage, formatNoQueuedNextStepMessage, hasQueuedNextStep } from "../../../apps/cli/src/core/execution-controls";
import { buildExecutionIterationPrompt } from "../../../apps/cli/src/core/handoff";
import { updatePlanManifest } from "../../../apps/cli/src/core/plan-manifest";
import { refreshPlanningAdvice } from "../../../apps/cli/src/core/planning-advice";
import { readPlanningPackState, type PlanningPackState } from "../../../apps/cli/src/core/planning-pack-state";
import { ensurePreparePack, recordVisibleChange, snapshotRevisionIfNeeded } from "../../../apps/cli/src/core/prepare-pack";
import type { ChatMessage } from "../../../apps/cli/src/core/prompts";
import { recordPlanningPackWrite, setHumanWriteConfirmation } from "../../../apps/cli/src/core/planning-state";
import { loadStudioOperateConfig, saveStudioOperateConfig } from "../../../apps/cli/src/core/studio-operate-config";
import { loadStudioSession, saveStudioSession } from "../../../apps/cli/src/core/studio-session";
import { loadStudioSettings, saveStudioSettings } from "../../../apps/cli/src/core/studio-settings";
import {
  loadStudioUiConfig,
  MAX_WHEEL_SENSITIVITY,
  MIN_WHEEL_SENSITIVITY,
  saveStudioUiConfig
} from "../../../apps/cli/src/core/studio-ui-config";
import { unblockTrackerStep } from "../../../apps/cli/src/core/tracker-unblock";
import { getPlanningPackPaths, readText, resolvePlanId, resolveWorkspace, saveActivePlanId } from "../../../apps/cli/src/core/workspace";
import { getStudioTheme, type StudioMode } from "@srgical/studio-shared";
import {
  delayStudioStream,
  getScrollableWheelStep,
  isDirectContextSyncRequest,
  limitContextSource,
  limitStudioSnippet,
  normalizeStudioStreamChunk,
  planStudioProgressiveReveal,
  renderCommandSyntaxHelpText,
  renderGatherFollowUp,
  renderOperateHelpText,
  renderPrepareHelpText,
  resolveStudioContextPath,
  selectAutoGatherFiles,
  toStudioContextLabel
} from "./helpers";
import type { StudioActionId, StudioActionRequest, StudioController, StudioEvent, StudioListener, StudioSnapshot } from "./types";

const GATHER_SOURCE_LIMIT = 6000;

type LiveStudioMessage = {
  append(chunk: string): void;
  finalize(content: string): Promise<void>;
  discard(): Promise<void>;
};

type StudioControllerOptions = {
  workspace?: string;
  planId?: string | null;
  mode?: StudioMode;
};

export async function createStudioController(options: StudioControllerOptions = {}): Promise<StudioController> {
  let mode: StudioMode = options.mode === "operate" ? "operate" : "prepare";
  const workspace = resolveWorkspace(options.workspace);
  const planId = await resolvePlanId(workspace, options.planId).catch(async () => {
    if (mode === "prepare" && options.planId) {
      return options.planId;
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
  let uiConfig = await loadStudioUiConfig(workspace, { planId });
  let settings = await loadStudioSettings();
  let busy = false;
  let busyStatus = "ready";
  let gatheredFingerprint = "";
  let started = false;
  const listeners = new Set<StudioListener>();

  const buildSnapshot = (): StudioSnapshot => ({
    mode,
    workspace,
    workspaceLabel: path.basename(workspace) || workspace,
    planId,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    state,
    busy,
    busyStatus,
    agentLabel: agent.status.label,
    uiConfig,
    settings,
    theme: getStudioTheme(settings.themeId),
    actions: buildActionStates(mode, state),
    footerText:
      busy
        ? `Working: ${busyStatus}`
        : mode === "prepare"
          ? "Text chats with planner | :help | F2 Gather F3 Build F4 Slice F5 Review F6 Approve F7 Operate"
          : "Commands start with : | :help | F2 Run F3 Auto F4 Checkpoint F5 Prepare F6 Review F7 Unblock"
  });

  const emit = (event: StudioEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const publishSnapshot = () => {
    emit({
      type: "snapshot",
      snapshot: buildSnapshot()
    });
  };

  const refresh = async () => {
    state = await readPlanningPackState(workspace, { planId });
    agent = await resolvePrimaryAgent(workspace, { planId });
    uiConfig = await loadStudioUiConfig(workspace, { planId });
    settings = await loadStudioSettings();
    publishSnapshot();
  };

  const persistMessages = async () => {
    await saveStudioSession(workspace, messages, { planId });
  };

  const push = async (message: ChatMessage) => {
    messages.push(message);
    await persistMessages();
    publishSnapshot();
  };

  const system = async (content: string) => {
    await push({ role: "system", content });
  };

  const setBusyState = (nextBusy: boolean, status = "ready") => {
    busy = nextBusy;
    busyStatus = status;
    publishSnapshot();
  };

  const readContextSource = async (rawPath: string, sourceLimit: number | null = GATHER_SOURCE_LIMIT) => {
    const resolvedPath = resolveStudioContextPath(workspace, rawPath);
    const body = await readText(resolvedPath);
    const label = toStudioContextLabel(workspace, resolvedPath);

    return {
      label,
      body,
      source: {
        path: label,
        content: limitContextSource(body.trim(), sourceLimit)
      }
    };
  };

  const startLiveMessage = (role: ChatMessage["role"], initialContent = ""): LiveStudioMessage => {
    const message: ChatMessage = { role, content: initialContent };
    messages.push(message);
    publishSnapshot();
    let pending = "";
    let draining = false;
    let generation = 0;
    let idleResolvers: Array<() => void> = [];

    const remove = () => {
      const index = messages.indexOf(message);
      if (index >= 0) {
        messages.splice(index, 1);
      }
    };

    const resolveIdle = () => {
      const resolvers = idleResolvers;
      idleResolvers = [];
      for (const resolver of resolvers) {
        resolver();
      }
    };

    const waitForIdle = async () => {
      if (!draining && pending.length === 0) {
        return;
      }
      await new Promise<void>((resolve) => {
        idleResolvers.push(resolve);
      });
    };

    const drainPending = async (expectedGeneration: number) => {
      if (draining) {
        return;
      }
      draining = true;
      try {
        while (generation === expectedGeneration && pending.length > 0) {
          message.content += pending[0] ?? "";
          pending = pending.slice(1);
          publishSnapshot();
          if (pending.length > 0) {
            await delayStudioStream();
          }
        }
      } finally {
        draining = false;
        if (pending.length > 0) {
          void drainPending(generation);
          return;
        }
        resolveIdle();
      }
    };

    const queuePending = (content: string, appendMode: "append" | "replace") => {
      if (appendMode === "replace") {
        generation += 1;
        pending = content;
      } else {
        pending += content;
      }
      if (!draining || appendMode === "replace") {
        void drainPending(generation);
      }
    };

    return {
      append(chunk: string) {
        const normalized = normalizeStudioStreamChunk(chunk);
        if (!normalized) {
          return;
        }
        queuePending(normalized, "append");
      },
      async finalize(content: string) {
        const finalized = content.trim();
        if (!finalized) {
          generation += 1;
          pending = "";
          await waitForIdle();
          remove();
          await persistMessages();
          publishSnapshot();
          return;
        }
        const reveal = planStudioProgressiveReveal(message.content, finalized);
        message.content = reveal.visible;
        publishSnapshot();
        queuePending(reveal.pending, "replace");
        await waitForIdle();
        if (!message.content) {
          remove();
        }
        await persistMessages();
        publishSnapshot();
      },
      async discard() {
        generation += 1;
        pending = "";
        await waitForIdle();
        remove();
        await persistMessages();
        publishSnapshot();
      }
    };
  };

  const refreshContext = async (
    sources: Array<{ path: string; content: string }>,
    options: {
      completionLabel: string;
      preserveSourcesVerbatim?: boolean;
    }
  ) => {
    const liveResult = startLiveMessage("system", `${options.completionLabel} is running...\n\n`);
    try {
      const result = await syncPlanningContext(workspace, [...messages], sources, {
        planId,
        preserveSourcesVerbatim: options.preserveSourcesVerbatim,
        onOutputChunk: (chunk) => {
          liveResult.append(chunk);
        }
      });
      await refresh();
      await liveResult.finalize(
        `${options.completionLabel} completed.\nVisible change: ${result.headline}\nEvidence: ${result.evidence.join(", ") || "none"}\nUnknowns: ${result.unknowns.join(" | ") || "none"}\nNext action: ${result.nextAction}\n${getPrimaryAgentAdapter().label} summary:\n${result.summary}`
      );
      return result;
    } catch (error) {
      await liveResult.discard();
      throw error;
    }
  };

  const importContextFile = async (rawPath: string) => {
    if (busy) {
      return;
    }
    const requestedPath = rawPath.trim();
    if (!requestedPath) {
      await system("Import needs a file path.\nUsage: `:import <path>`");
      return;
    }

    setBusyState(true, "importing context...");
    try {
      const loaded = await readContextSource(requestedPath, null);
      await system(
        `Loaded context file: ${loaded.label}\n\n===== BEGIN FILE ${loaded.label} =====\n${limitStudioSnippet(loaded.body.trim())}\n===== END FILE ${loaded.label} =====`
      );
      const result = await refreshContext([loaded.source], {
        completionLabel: "Context Import",
        preserveSourcesVerbatim: true
      });
      await system(`Imported context from ${loaded.label}.\nNext action: ${result.nextAction}`);
    } catch (error) {
      await system(`Context import failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyState(false);
    }
  };

  const autoGather = async (origin: "boot" | "manual") => {
    if (busy) {
      return;
    }
    setBusyState(true, origin === "boot" ? "auto-gathering..." : "gathering...");
    try {
      const files = await selectAutoGatherFiles(workspace);
      const fingerprint = files.join("|");
      if (origin === "boot" && fingerprint === gatheredFingerprint) {
        setBusyState(false);
        return;
      }
      gatheredFingerprint = fingerprint;
      const gatheredSources: Array<{ path: string; content: string }> = [];
      for (const relativePath of files) {
        const loaded = await readContextSource(relativePath, GATHER_SOURCE_LIMIT).catch(() => null);
        if (!loaded) {
          continue;
        }
        gatheredSources.push(loaded.source);
        await system(
          `Loaded context file: ${loaded.label}\n\n===== BEGIN FILE ${loaded.label} =====\n${limitStudioSnippet(loaded.body.trim())}\n===== END FILE ${loaded.label} =====`
        );
      }
      let contextResult: Awaited<ReturnType<typeof syncPlanningContext>> | null = null;
      if (gatheredSources.length > 0) {
        contextResult = await refreshContext(gatheredSources, {
          completionLabel: origin === "boot" ? "Auto Context Sync" : "Gather Context Sync"
        });
      } else {
        await updatePlanManifest(
          workspace,
          {
            stage: "discover",
            nextAction: "Review the gathered evidence, then build the draft when you have enough context.",
            evidence: files,
            unknowns: state.unknowns.length > 0 ? state.unknowns : ["Desired outcome still needs a clean confirmation."],
            contextReady: false
          },
          { planId }
        );
        await refreshPlanningAdvice(workspace, messages, { planId }).catch(() => null);
        await refresh();
      }
      await system(
        renderGatherFollowUp(state, state.advice, {
          evidenceCount: (contextResult?.evidence ?? files).length
        })
      );
    } catch (error) {
      await system(`Auto-gather failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyState(false);
    }
  };

  const buildDraft = async () => {
    if (busy) {
      return;
    }
    if (!state.readiness.readyToWrite) {
      await system(`Build Draft is blocked.\nMissing: ${state.readiness.missingLabels.join(", ") || "none"}`);
      return;
    }
    setBusyState(true, "building draft...");
    let liveResult: LiveStudioMessage | null = null;
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const snapshot = await snapshotRevisionIfNeeded(workspace, { planId });
      const activeLiveResult = (liveResult = startLiveMessage("system", "Build Draft is running...\n\n"));
      const result = await writePlanningPack(workspace, [...messages], {
        planId,
        onOutputChunk: (chunk) => {
          activeLiveResult.append(chunk);
        }
      });
      await recordPlanningPackWrite(workspace, "write", { planId });
      await refreshPlanningAdvice(workspace, messages, { planId }).catch(() => null);
      const headline = await recordVisibleChange(workspace, before, "Built or refreshed the prepare draft.", {
        planId,
        action: before.manifest ? "refine" : "prepare",
        stage: "Prepare",
        nextAction: "Review the draft, slice the plan if needed, then approve when it is clear enough to operate."
      });
      await refresh();
      await activeLiveResult.finalize(
        `Build Draft completed.\nRevision snapshot: ${snapshot ?? "none"}\nVisible change: ${headline}\n${getPrimaryAgentAdapter().label} summary:\n${result}`
      );
    } catch (error) {
      await liveResult?.discard();
      await system(`Build Draft failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyState(false);
    }
  };

  const slicePlan = async (options: PlanDiceOptions = DEFAULT_SLICE_PLAN_OPTIONS, label = "Slice Plan") => {
    if (busy) {
      return;
    }
    if (!state.readiness.readyToDice) {
      await system("Slice Plan is blocked until a draft exists.");
      return;
    }
    setBusyState(true, "slicing plan...");
    let liveResult: LiveStudioMessage | null = null;
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const snapshot = await snapshotRevisionIfNeeded(workspace, { planId });
      const activeLiveResult = (liveResult = startLiveMessage("system", `${label} is running...\n\n`));
      const result = await dicePlanningPack(workspace, [...messages], options, {
        planId,
        onOutputChunk: (chunk) => {
          activeLiveResult.append(chunk);
        }
      });
      await recordPlanningPackWrite(workspace, "dice", { planId });
      const headline = await recordVisibleChange(workspace, before, "Sliced the draft into execution-ready steps.", {
        planId,
        action: "refine",
        stage: "Prepare",
        nextAction: "Review the sliced tracker, then approve when the next step is clear enough to operate."
      });
      await refresh();
      await activeLiveResult.finalize(
        `${label} completed.\nSettings: ${renderPlanDiceLabel(options)}\nRevision snapshot: ${snapshot ?? "none"}\nVisible change: ${headline}\n${getPrimaryAgentAdapter().label} summary:\n${result}`
      );
    } catch (error) {
      await liveResult?.discard();
      await system(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyState(false);
    }
  };

  const approve = async () => {
    if (!state.readiness.readyToApprove) {
      await system("Approve Ready is blocked until a draft has been built or sliced.");
      return;
    }
    const before = await readPackSnapshot(workspace, { planId });
    await setHumanWriteConfirmation(workspace, true, { planId });
    await updatePlanManifest(workspace, { stage: "ready", approvedAt: new Date().toISOString(), contextReady: true }, { planId });
    const headline = await recordVisibleChange(workspace, before, "Approved the current draft for operate.", {
      planId,
      action: "refine",
      stage: "Ready",
      nextAction: "Open operate and run the next step."
    });
    await refresh();
    await system(`Approve Ready completed.\nVisible change: ${headline}`);
  };

  const review = async () => {
    const paths = getPlanningPackPaths(workspace, { planId });
    await system(
      [
        `Current stage: ${state.mode}`,
        `Next action: ${state.nextAction}`,
        `Last change: ${state.manifest?.lastChangeSummary ?? "none"}`,
        "",
        "changes.md",
        limitStudioSnippet((await readText(paths.changes).catch(() => "")).trim()),
        "",
        "manifest.json",
        limitStudioSnippet((await readText(paths.manifest).catch(() => "")).trim())
      ].join("\n")
    );
  };

  const runStep = async () => {
    if (busy) {
      return;
    }
    if (!hasQueuedNextStep(state.currentPosition.nextRecommended)) {
      await system(formatNoQueuedNextStepMessage("studio"));
      return;
    }
    if (state.approvalStatus !== "approved") {
      await system("Operate requires an approved draft. Switch to prepare and approve it first.");
      return;
    }
    setBusyState(true, "running next step...");
    let liveResult: LiveStudioMessage | null = null;
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const prompt = await buildExecutionIterationPrompt(workspace, state, { planId });
      const activeLiveResult = (liveResult = startLiveMessage("system", "Run next step is executing...\n\n"));
      const result = await runNextPrompt(workspace, prompt.prompt, {
        planId,
        onOutputChunk: (chunk) => {
          activeLiveResult.append(chunk);
        }
      });
      await saveExecutionState(workspace, "success", "studio", result, { planId });
      await appendExecutionLog(workspace, "success", "studio", result, {
        planId,
        stepLabel: state.nextStepSummary?.id ?? state.currentPosition.nextRecommended
      });
      await refresh();
      const stage = state.mode === "Blocked" ? "Blocked" : state.currentPosition.nextRecommended ? "Execute" : "Finished";
      const headline = await recordVisibleChange(workspace, before, "Executed one operate step.", {
        planId,
        action: "operate",
        stage,
        nextAction:
          stage === "Blocked"
            ? "Resolve the blocker or reopen prepare."
            : stage === "Finished"
              ? "Review the outcome or reopen prepare to extend the plan."
              : "Run the next step or switch on auto continue."
      });
      await refresh();
      await activeLiveResult.finalize(
        `Run next step completed.\nPrompt source: ${prompt.handoffDoc.displayPath}\nVisible change: ${headline}\n${getPrimaryAgentAdapter().label} summary:\n${result}`
      );
    } catch (error) {
      await liveResult?.discard();
      const message = error instanceof Error ? error.message : String(error);
      await saveExecutionState(workspace, "failure", "studio", message, { planId });
      await appendExecutionLog(workspace, "failure", "studio", message, {
        planId,
        stepLabel: state.nextStepSummary?.id ?? state.currentPosition.nextRecommended
      });
      await refresh();
      await system(formatExecutionFailureMessage(message, state.nextStepSummary, state.currentPosition.nextRecommended, "studio"));
    } finally {
      setBusyState(false);
    }
  };

  const autoContinue = async (maxSteps?: number) => {
    if (busy) {
      return;
    }
    setBusyState(true, "auto continuing...");
    let liveResult: LiveStudioMessage | null = null;
    try {
      const before = await readPackSnapshot(workspace, { planId });
      const activeLiveResult = (liveResult = startLiveMessage("system", "Auto continue is running...\n\n"));
      const result = await executeAutoRun(workspace, {
        source: "studio",
        planId,
        maxSteps,
        onMessage: async (line) => {
          activeLiveResult.append(`${line}\n`);
        },
        onOutputChunk: (chunk) => {
          activeLiveResult.append(chunk);
        }
      });
      await refresh();
      const headline = await recordVisibleChange(workspace, before, "Auto continue ran one or more operate steps.", {
        planId,
        action: "operate",
        stage: state.mode,
        nextAction: state.nextAction,
        executionMode: "auto"
      });
      await refresh();
      await activeLiveResult.finalize(`Auto continue finished: ${result.summary}\nVisible change: ${headline}`);
    } catch (error) {
      await liveResult?.discard();
      await system(`Auto continue failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyState(false);
    }
  };

  const toggleCheckpoint = async () => {
    const config = await loadStudioOperateConfig(workspace, { planId });
    const updated = await saveStudioOperateConfig(workspace, { pauseForPr: !config.pauseForPr }, { planId });
    await updatePlanManifest(workspace, { executionMode: updated.pauseForPr ? "checkpoint" : "step" }, { planId });
    await refresh();
    await system(`Checkpoint mode ${updated.pauseForPr ? "enabled" : "disabled"}.`);
  };

  const setWheelSensitivity = async (rawValue?: string) => {
    const value = rawValue?.trim();
    const paths = getPlanningPackPaths(workspace, { planId });
    if (!value) {
      await system(
        [
          `Wheel sensitivity: ${uiConfig.wheelSensitivity}/10 (${getScrollableWheelStep(uiConfig.wheelSensitivity)} line${getScrollableWheelStep(uiConfig.wheelSensitivity) === 1 ? "" : "s"}/notch).`,
          `Config file: ${paths.relativeDir}/studio-ui-config.json`,
          `Usage: :wheel <${MIN_WHEEL_SENSITIVITY}-${MAX_WHEEL_SENSITIVITY}>`
        ].join("\n")
      );
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      await system(`Wheel sensitivity must be a number between ${MIN_WHEEL_SENSITIVITY} and ${MAX_WHEEL_SENSITIVITY}.`);
      return;
    }
    const updated = await saveStudioUiConfig(workspace, { wheelSensitivity: parsed }, { planId });
    uiConfig = updated;
    publishSnapshot();
    await system(
      [
        `Wheel sensitivity set to ${updated.wheelSensitivity}/10.`,
        `Applied wheel step: ${getScrollableWheelStep(updated.wheelSensitivity)} line${getScrollableWheelStep(updated.wheelSensitivity) === 1 ? "" : "s"} per notch.`,
        `Saved: ${paths.relativeDir}/studio-ui-config.json`
      ].join("\n")
    );
  };

  const setTheme = async (themeId?: string) => {
    if (!themeId) {
      await system(["Themes:", "- neon-command: Neon Command", "- amber-grid: Amber Grid"].join("\n"));
      return;
    }
    settings = await saveStudioSettings({ themeId });
    publishSnapshot();
    await system(`Theme set to ${getStudioTheme(settings.themeId).label}.`);
  };

  const resolveBlocker = async () => {
    const before = await readPackSnapshot(workspace, { planId });
    try {
      const result = await unblockTrackerStep(workspace, { planId, requestedStepId: state.currentPosition.nextRecommended ?? undefined });
      const headline = await recordVisibleChange(workspace, before, "Resolved a blocker and re-queued the next step.", {
        planId,
        action: "operate",
        stage: "Ready",
        nextAction: "Run the next step again now that it has been re-queued."
      });
      await refresh();
      await system(`Blocker resolved for \`${result.stepId}\`.\nVisible change: ${headline}`);
    } catch (error) {
      await system(`Resolve blocker failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleCommand = async (command: string) => {
    if (command === ":quit" || command === ":q") {
      return;
    }
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
    if (command === ":help slice" || command === ":help dice") {
      await system(renderPlanDiceHelp(":slice"));
      return;
    }
    if (command === ":status") {
      await system(`Mode: ${mode}\nStage: ${state.mode}\nNext action: ${state.nextAction}\nNext step: ${state.currentPosition.nextRecommended ?? "none"}`);
      return;
    }
    if (command === ":prepare") {
      mode = "prepare";
      await refresh();
      return;
    }
    if (command === ":operate") {
      mode = "operate";
      await refresh();
      return;
    }
    if (command === ":gather") {
      await autoGather("manual");
      return;
    }
    if (command === ":import" || command === ":read") {
      await system("Import needs a file path.\nUsage: `:import <path>`");
      return;
    }
    if (command === ":context") {
      if (busy) {
        return;
      }
      setBusyState(true, "syncing context...");
      try {
        const result = await refreshContext([], {
          completionLabel: "Context Sync"
        });
        await system(`Context sync completed.\nNext action: ${result.nextAction}`);
      } catch (error) {
        await system(`Context sync failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusyState(false);
      }
      return;
    }
    if (command.startsWith(":import ") || command.startsWith(":read ")) {
      const rawPath = command.startsWith(":import ") ? command.slice(":import ".length) : command.slice(":read ".length);
      await importContextFile(rawPath);
      return;
    }
    if (command === ":build") {
      await buildDraft();
      return;
    }
    if (command.startsWith(":slice")) {
      const intent = parsePlanDiceIntent(command);
      if (!intent || intent.command !== ":slice") {
        await system(`Unrecognized slice command.\n\n${renderPlanDiceHelp(":slice")}`);
        return;
      }
      if (intent.helpRequested) {
        await system(renderPlanDiceHelp(":slice"));
        return;
      }
      await slicePlan(intent.options, "Slice Plan");
      return;
    }
    if (command === ":approve") {
      await approve();
      return;
    }
    if (command === ":review") {
      await review();
      return;
    }
    if (command === ":run") {
      await runStep();
      return;
    }
    if (command.startsWith(":auto")) {
      const raw = command.slice(":auto".length).trim();
      const max = raw ? Number(raw) : undefined;
      await autoContinue(Number.isFinite(max) ? max : undefined);
      return;
    }
    if (command === ":checkpoint") {
      await toggleCheckpoint();
      return;
    }
    if (command === ":wheel") {
      await setWheelSensitivity();
      return;
    }
    if (command.startsWith(":wheel ")) {
      await setWheelSensitivity(command.slice(":wheel ".length));
      return;
    }
    if (command === ":theme") {
      await setTheme();
      return;
    }
    if (command.startsWith(":theme ")) {
      await setTheme(command.slice(":theme ".length).trim());
      return;
    }
    if (command === ":unblock") {
      await resolveBlocker();
      return;
    }
    if (command === ":stop") {
      const result = await requestAutoRunStop(workspace, { planId });
      await system(result.stopReason ?? "Stop requested.");
      await refresh();
      return;
    }
    await system(`Unknown command: ${command}\nTry \`:help\` to list commands or \`:help commands\` for the quick command syntax explanation.`);
  };

  const submitInput = async (text: string) => {
    const value = text.trim();
    if (!value) {
      return;
    }
    if (value.startsWith(":")) {
      await push({ role: "system", content: `Command: ${value}` });
      await handleCommand(value);
      return;
    }
    const diceIntent = parsePlanDiceIntent(value);
    if (diceIntent) {
      await push({ role: "system", content: `Command: ${value}` });
      if (mode !== "prepare") {
        await system("Slicing is only available in prepare mode. Switch back to prepare first.");
        return;
      }
      if (diceIntent.helpRequested) {
        await system(renderPlanDiceHelp(diceIntent.command));
        return;
      }
      await slicePlan(diceIntent.options, diceIntent.command === "/dice" ? "Legacy /dice compatibility slice" : "Slice Plan");
      return;
    }
    if (value === "/help") {
      await push({ role: "system", content: "Command: /help" });
      await system(mode === "prepare" ? renderPrepareHelpText() : renderOperateHelpText());
      return;
    }
    if (value.startsWith("/")) {
      await push({ role: "system", content: `Command: ${value}` });
      if (mode === "prepare" && (value.startsWith("/read ") || value.startsWith("/import "))) {
        const rawPath = value.startsWith("/read ") ? value.slice("/read ".length) : value.slice("/import ".length);
        await importContextFile(rawPath);
        return;
      }
      await system("Slash commands were retired in the rebooted studio.\nUse `:` commands now, for example `:help`, `:gather`, `:slice --help`, or `:operate`.\nIf you just want to chat with the planner, type plain text without a prefix.");
      return;
    }
    if (mode === "operate") {
      await system("Operate is action-first. Use the primary actions or the :command palette.");
      return;
    }
    setBusyState(true, "thinking...");
    let liveReply: LiveStudioMessage | null = null;
    try {
      await push({ role: "user", content: value });
      if (isDirectContextSyncRequest(value)) {
        const result = await refreshContext([], {
          completionLabel: "Context Sync"
        });
        await system(`Context sync completed from your instruction.\nNext action: ${result.nextAction}`);
        return;
      }
      const activeLiveReply = (liveReply = startLiveMessage("assistant"));
      const reply = await requestPlannerReply(workspace, [...messages], {
        planId,
        onOutputChunk: (chunk) => {
          activeLiveReply.append(chunk);
        }
      });
      await activeLiveReply.finalize(reply.trim());
      await refreshPlanningAdvice(workspace, messages, { planId }).catch(() => null);
      await refresh();
    } catch (error) {
      await liveReply?.discard();
      await system(`Planner request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyState(false);
    }
  };

  const dispatch = async (request: StudioActionRequest) => {
    emit({
      type: "action",
      phase: "start",
      action: request.type,
      snapshot: buildSnapshot()
    });
    try {
      switch (request.type) {
        case "gather":
          await autoGather("manual");
          break;
        case "context":
          await handleCommand(":context");
          break;
        case "build":
          await buildDraft();
          break;
        case "slice":
          await slicePlan(request.diceOptions ?? DEFAULT_SLICE_PLAN_OPTIONS, request.label ?? "Slice Plan");
          break;
        case "approve":
          await approve();
          break;
        case "review":
          await review();
          break;
        case "run":
          await runStep();
          break;
        case "auto":
          await autoContinue(request.maxSteps);
          break;
        case "checkpoint":
          await toggleCheckpoint();
          break;
        case "unblock":
          await resolveBlocker();
          break;
        case "stop":
          await handleCommand(":stop");
          break;
        case "switch-mode":
          mode = request.mode === "operate" ? "operate" : "prepare";
          await refresh();
          break;
        case "import":
          await importContextFile(request.filePath ?? "");
          break;
        case "wheel":
          await setWheelSensitivity(typeof request.wheelSensitivity === "number" ? String(request.wheelSensitivity) : undefined);
          break;
        case "theme":
          await setTheme(request.themeId);
          break;
        case "command":
          await handleCommand(request.command ?? "");
          break;
      }
    } finally {
      emit({
        type: "action",
        phase: "finish",
        action: request.type,
        snapshot: buildSnapshot()
      });
    }
  };

  return {
    async start() {
      if (started) {
        return;
      }
      started = true;
      await system(
        mode === "prepare"
          ? `Prepare mode gathers context, keeps \`context.md\` current, builds the draft, slices it into steps, and gets the plan ready to operate.\nType normal text to chat with the planner.\nUse \`:\` to run a studio command such as \`:import <path>\`, \`:context\`, \`:build\`, \`:slice --help\`, or \`:operate\`.\nStage: ${state.mode}\nNext action: ${state.nextAction}`
          : `Operate mode is execution-only.\nUse \`:\` to run studio commands such as \`:run\`, \`:auto 3\`, \`:checkpoint\`, or \`:prepare\`.\nStage: ${state.mode}\nNext action: ${state.nextAction}`
      );
      await refresh();
      if (mode === "prepare") {
        await autoGather("boot");
      }
    },
    async close() {
      return;
    },
    getSnapshot() {
      return buildSnapshot();
    },
    subscribe(listener: StudioListener) {
      listeners.add(listener);
      listener({
        type: "snapshot",
        snapshot: buildSnapshot()
      });
      return () => {
        listeners.delete(listener);
      };
    },
    submitInput,
    dispatch
  };
}

function buildActionStates(mode: StudioMode, state: PlanningPackState): Record<StudioActionId, { enabled: boolean; blockedReason: string | null }> {
  const prepareOnly = mode === "prepare";
  const runReady = hasQueuedNextStep(state.currentPosition.nextRecommended) && state.approvalStatus === "approved";

  return {
    gather: { enabled: prepareOnly, blockedReason: prepareOnly ? null : "Gather is only available in prepare mode." },
    context: { enabled: prepareOnly, blockedReason: prepareOnly ? null : "Context sync is only available in prepare mode." },
    build: {
      enabled: prepareOnly && state.readiness.readyToWrite,
      blockedReason: prepareOnly
        ? state.readiness.readyToWrite
          ? null
          : `Missing: ${state.readiness.missingLabels.join(", ") || "none"}`
        : "Build is only available in prepare mode."
    },
    slice: {
      enabled: prepareOnly && state.readiness.readyToDice,
      blockedReason: prepareOnly ? (state.readiness.readyToDice ? null : "Slice is blocked until a draft exists.") : "Slice is only available in prepare mode."
    },
    approve: {
      enabled: prepareOnly && state.readiness.readyToApprove,
      blockedReason: prepareOnly ? (state.readiness.readyToApprove ? null : "Approve is blocked until a draft exists.") : "Approve is only available in prepare mode."
    },
    review: { enabled: true, blockedReason: null },
    run: {
      enabled: !prepareOnly && runReady,
      blockedReason: !prepareOnly ? (runReady ? null : "Run is blocked until the draft is approved and a next step is queued.") : "Run is only available in operate mode."
    },
    auto: {
      enabled: !prepareOnly && runReady,
      blockedReason: !prepareOnly ? (runReady ? null : "Auto continue is blocked until the draft is approved and a next step is queued.") : "Auto continue is only available in operate mode."
    },
    checkpoint: { enabled: !prepareOnly, blockedReason: !prepareOnly ? null : "Checkpoint mode is only available in operate mode." },
    unblock: {
      enabled: !prepareOnly && Boolean(state.currentPosition.nextRecommended),
      blockedReason: !prepareOnly ? (state.currentPosition.nextRecommended ? null : "There is no queued step to unblock.") : "Unblock is only available in operate mode."
    },
    stop: { enabled: true, blockedReason: null },
    "switch-mode": { enabled: true, blockedReason: null },
    import: { enabled: prepareOnly, blockedReason: prepareOnly ? null : "Import is only available in prepare mode." },
    wheel: { enabled: true, blockedReason: null },
    theme: { enabled: true, blockedReason: null },
    command: { enabled: true, blockedReason: null }
  };
}
