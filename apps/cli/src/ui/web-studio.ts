import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { cp, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  type FinishWorkAssessment,
  type FinishWorkRequest,
  type FinishWorkResult,
  type ConversationStartRequest,
  createStudioController,
  type LaneCreateRequest,
  type LaneOpenResponse,
  type RepoSnapshot,
  type StudioActionRequest,
  type StudioController,
  type StudioEvent,
  type StudioSnapshot
} from "@srgical/studio-core";
import { AgentSessionStore, deriveRepositoryId, detectAgentAuthOptions } from "@srgical/agent-runtime";
import type { StudioAuthOptionId, StudioMode } from "@srgical/studio-shared";
import {
  installConnectorPreset as installRepoConnectorPreset,
  loadConnectorRegistry,
  removeConnector as removeRepoConnector,
  setConnectorEnabled as setRepoConnectorEnabled
} from "@srgical/connector-registry";
import { fileExists } from "../core/workspace";
import {
  archiveWorktreeLane,
  createWorktreeLane,
  markWorktreeLaneOpened,
  resolveLaneWorkspacePath,
  resolveWorktreeLaneRepoState,
  removeWorktreeLane,
  setWorktreeLaneDeleteLock
} from "../core/worktree-lanes";
import { listReferenceDirectoryOptions } from "../core/reference-library";
import { assessFinishWork } from "../core/finish-work";
import { loadStudioSettings, saveStudioSettings } from "../core/studio-settings";
import { loadRecentRepositories, recordRecentRepository } from "../core/repository-history";

export type LaunchWebStudioOptions = {
  workspace?: string;
  planId?: string | null;
  mode?: StudioMode;
  openBrowser?: boolean;
  port?: number;
  agentSessionStore?: AgentSessionStore;
  repositoryHistoryHomeDir?: string;
};

type StudioSession = {
  token: string;
  laneId: string;
  workspace: string;
  planId: string;
  mode: StudioMode;
  controller: StudioController;
  startPromise: Promise<void>;
};

export type WebStudioHost = {
  getRepoSnapshot(): Promise<RepoSnapshot>;
  selectRepository(workspace: string): Promise<RepoSnapshot>;
  selectAuthOption(authOptionId: StudioAuthOptionId): Promise<RepoSnapshot>;
  installConnector(presetId: string): Promise<RepoSnapshot>;
  setConnectorEnabled(connectorId: string, enabled: boolean): Promise<RepoSnapshot>;
  removeConnector(connectorId: string): Promise<RepoSnapshot>;
  startConversation(request: ConversationStartRequest): Promise<LaneOpenResponse>;
  createLane(request: LaneCreateRequest): Promise<LaneOpenResponse>;
  openLane(laneId: string, mode: StudioMode, agentSessionId?: string): Promise<LaneOpenResponse>;
  openSession(sessionId: string): Promise<LaneOpenResponse>;
  forkSessionIntoWorktree(sessionId: string): Promise<LaneOpenResponse>;
  archiveLane(laneId: string): Promise<void>;
  setLaneDeleteLock(laneId: string, deleteLocked: boolean): Promise<void>;
  removeLane(laneId: string): Promise<void>;
  assessFinish(laneId: string): Promise<FinishWorkAssessment>;
  finishLane(request: FinishWorkRequest): Promise<FinishWorkResult>;
  updateSession(sessionId: string, action: "pin" | "unpin" | "archive" | "restore" | "delete"): Promise<void>;
  getStudioSession(token: string): StudioSession | null;
  close(): Promise<void>;
};

export async function launchWebStudio(options: LaunchWebStudioOptions = {}): Promise<void> {
  const assetRoot = await resolveStudioWebAssetRoot();
  if (!assetRoot) {
    throw new Error("The Studio web bundle is not built yet. Run `npm run build` before launching the web UI.");
  }

  const dashboardToken = randomBytes(24).toString("hex");
  const host = await createWebStudioHost(options);
  const server = createServer(async (request, response) => {
    try {
      await routeRequest(request, response, {
        assetRoot,
        dashboardToken,
        host
      });
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  const port = resolveStudioPort(options.port, process.env.SRGICAL_STUDIO_PORT);
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "EADDRINUSE"
        ? new Error(`Srgical Studio is already using http://127.0.0.1:${port}. Close the other instance or set SRGICAL_STUDIO_PORT.`)
        : error);
    });
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind the Studio web server.");
  }

  const url = `http://127.0.0.1:${address.port}/?token=${dashboardToken}`;
  process.stdout.write(`Studio web UI: ${url}\n`);
  if (options.openBrowser !== false) {
    openUrl(url);
  }

  const shutdown = async () => {
    await host.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  process.once("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });
  process.once("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });

  await new Promise<void>(() => {
    // Keep the command alive while the local server is active.
  });
}

export async function createWebStudioHost(options: LaunchWebStudioOptions = {}): Promise<WebStudioHost> {
  const agentSessionStore = options.agentSessionStore ?? new AgentSessionStore();
  const initialWorkspace = await resolveInitialWorkspace(options.workspace, options.repositoryHistoryHomeDir);
  let activeHost = await createRepositoryWebStudioHost({ ...options, workspace: initialWorkspace, agentSessionStore });
  let activeSnapshot = await activeHost.getRepoSnapshot();
  await recordRecentRepository(activeSnapshot.currentWorkspace, options.repositoryHistoryHomeDir).catch(() => []);

  const decorateSnapshot = async (snapshot: RepoSnapshot): Promise<RepoSnapshot> => {
    const history = await loadRecentRepositories(options.repositoryHistoryHomeDir).catch(() => []);
    const currentPath = path.resolve(snapshot.currentWorkspace);
    const currentKey = normalizeRepositoryPath(currentPath);
    const currentHistory = history.find((entry) => normalizeRepositoryPath(entry.path) === currentKey);
    const choices = [
      { path: currentPath, lastOpenedAt: currentHistory?.lastOpenedAt ?? new Date().toISOString() },
      ...history.filter((entry) => normalizeRepositoryPath(entry.path) !== currentKey)
    ];
    return {
      ...snapshot,
      repositories: choices.map((entry) => ({
        path: entry.path,
        label: path.basename(entry.path) || entry.path,
        selected: normalizeRepositoryPath(entry.path) === currentKey,
        lastOpenedAt: entry.lastOpenedAt
      }))
    };
  };

  const withSnapshot = async (operation: () => Promise<RepoSnapshot>): Promise<RepoSnapshot> => {
    activeSnapshot = await operation();
    return decorateSnapshot(activeSnapshot);
  };

  return {
    getRepoSnapshot: () => withSnapshot(() => activeHost.getRepoSnapshot()),
    async selectRepository(workspace: string) {
      const requested = workspace.trim();
      if (!requested) throw new Error("Choose a working directory.");
      const nextHost = await createRepositoryWebStudioHost({
        ...options,
        workspace: path.resolve(requested),
        planId: null,
        mode: undefined,
        agentSessionStore
      });
      const nextSnapshot = await nextHost.getRepoSnapshot();
      await activeHost.close();
      activeHost = nextHost;
      activeSnapshot = nextSnapshot;
      await recordRecentRepository(nextSnapshot.currentWorkspace, options.repositoryHistoryHomeDir).catch(() => []);
      return decorateSnapshot(nextSnapshot);
    },
    selectAuthOption: (authOptionId) => withSnapshot(() => activeHost.selectAuthOption(authOptionId)),
    installConnector: (presetId) => withSnapshot(() => activeHost.installConnector(presetId)),
    setConnectorEnabled: (connectorId, enabled) => withSnapshot(() => activeHost.setConnectorEnabled(connectorId, enabled)),
    removeConnector: (connectorId) => withSnapshot(() => activeHost.removeConnector(connectorId)),
    startConversation: (request) => activeHost.startConversation(request),
    createLane: (request) => activeHost.createLane(request),
    openLane: (laneId, mode, agentSessionId) => activeHost.openLane(laneId, mode, agentSessionId),
    openSession: (sessionId) => activeHost.openSession(sessionId),
    forkSessionIntoWorktree: (sessionId) => activeHost.forkSessionIntoWorktree(sessionId),
    archiveLane: (laneId) => activeHost.archiveLane(laneId),
    setLaneDeleteLock: (laneId, deleteLocked) => activeHost.setLaneDeleteLock(laneId, deleteLocked),
    removeLane: (laneId) => activeHost.removeLane(laneId),
    assessFinish: (laneId) => activeHost.assessFinish(laneId),
    finishLane: (request) => activeHost.finishLane(request),
    updateSession: (sessionId, action) => activeHost.updateSession(sessionId, action),
    getStudioSession: (token) => activeHost.getStudioSession(token),
    close: () => activeHost.close()
  };
}

async function createRepositoryWebStudioHost(options: LaunchWebStudioOptions): Promise<WebStudioHost> {
  const selectedWorkspace = path.resolve(options.workspace ?? process.cwd());
  const repoState = await resolveWorktreeLaneRepoState(selectedWorkspace);
  const sessions = new Map<string, StudioSession>();
  const workspaceTokens = new Map<string, string>();
  const agentSessionStore = options.agentSessionStore ?? new AgentSessionStore();
  const repoId = deriveRepositoryId(repoState.repoRoot);

  const getRepoSnapshot = async (): Promise<RepoSnapshot> => {
    const nextRepoState = await resolveWorktreeLaneRepoState(repoState.currentWorkspace);
    const agentSessions = (await agentSessionStore.list(repoId)).filter((session) => session.lifecycle !== "deleted");
    const settings = await loadStudioSettings();
    const authOptions = await detectAgentAuthOptions(settings.preferredAuthOptionId);
    const connectors = await loadConnectorRegistry(repoId);
    return {
      repoRoot: nextRepoState.repoRoot,
      repoLabel: path.basename(selectedWorkspace) || selectedWorkspace,
      currentWorkspace: selectedWorkspace,
      isGitRepository: nextRepoState.isGitRepository,
      repositories: [],
      requestedPlanId: options.planId ?? null,
      requestedMode: options.mode ?? null,
      lanes: nextRepoState.lanes,
      sessions: agentSessions,
      settings,
      authOptions,
      connectors
    };
  };

  const selectAuthOption = async (authOptionId: StudioAuthOptionId): Promise<RepoSnapshot> => {
    const authOptions = await detectAgentAuthOptions(null);
    const requested = authOptions.find((item) => item.id === authOptionId);
    if (!requested) throw new Error("Choose a supported authentication option.");
    if (!requested.authenticated) {
      throw new Error(`${requested.providerLabel} · ${requested.label} is not connected. ${requested.setupHint}`);
    }
    await saveStudioSettings({ preferredAuthOptionId: authOptionId });
    return getRepoSnapshot();
  };

  const installConnector = async (presetId: string): Promise<RepoSnapshot> => {
    await installRepoConnectorPreset(repoId, presetId);
    return getRepoSnapshot();
  };

  const setConnectorEnabled = async (connectorId: string, enabled: boolean): Promise<RepoSnapshot> => {
    await setRepoConnectorEnabled(repoId, connectorId, enabled);
    return getRepoSnapshot();
  };

  const removeConnector = async (connectorId: string): Promise<RepoSnapshot> => {
    await removeRepoConnector(repoId, connectorId);
    return getRepoSnapshot();
  };

  const openLane = async (
    laneId: string,
    mode: StudioMode,
    agentSessionId?: string,
    planIdOverride?: string,
    autoGatherOnStart = true
  ): Promise<LaneOpenResponse> => {
    const workspace = laneId === "current"
      ? selectedWorkspace
      : await resolveLaneWorkspacePath(repoState.currentWorkspace, laneId);
    if (!workspace) {
      throw new Error(`Unknown worktree lane \`${laneId}\`.`);
    }

    const snapshot = await getRepoSnapshot();
    const lane = snapshot.lanes.find((entry) => entry.laneId === laneId);
    if (!lane) {
      throw new Error(`Unknown worktree lane \`${laneId}\`.`);
    }
    const requestedAgentSession = agentSessionId ? await agentSessionStore.load(repoId, agentSessionId) : null;
    const planId = planIdOverride ?? lane.planId ?? requestedAgentSession?.planId ?? options.planId;
    if (!planId) {
      throw new Error(`Lane \`${laneId}\` does not have a plan id yet.`);
    }

    const workspaceKey = `${laneId}:${planId}`;
    let studioToken = workspaceTokens.get(workspaceKey);
    let session = studioToken ? sessions.get(studioToken) ?? null : null;
    if (
      !session
      || session.mode !== mode
      || session.planId !== planId
      || session.workspace !== workspace
      || Boolean(requestedAgentSession && session.controller.getSnapshot().agentProvider.providerId !== requestedAgentSession.providerId)
    ) {
      if (session) {
        await session.controller.close();
        sessions.delete(session.token);
      }
      studioToken = randomBytes(24).toString("hex");
      workspaceTokens.set(workspaceKey, studioToken);
      const controller = await createStudioController({
        workspace,
        planId,
        mode,
        repoRoot: snapshot.repoRoot,
        isGitRepository: snapshot.isGitRepository,
        laneId,
        agentSessionId,
        agentProviderId: requestedAgentSession?.providerId,
        autoGatherOnStart,
        agentSessionStore
      });
      const startPromise = controller.start().catch(async () => {
        await controller.close().catch(() => undefined);
        if (workspaceTokens.get(workspaceKey) === studioToken) {
          workspaceTokens.delete(workspaceKey);
        }
      });
      session = {
        token: studioToken,
        laneId,
        workspace,
        planId,
        mode,
        controller,
        startPromise
      };
      sessions.set(studioToken, session);
    } else if (agentSessionId && session.controller.getSnapshot().agentSession.sessionId !== agentSessionId) {
      await session.controller.dispatch({ type: "session-switch", sessionId: agentSessionId });
    }

    if (!studioToken) {
      throw new Error(`Failed to create a Studio session token for lane \`${laneId}\`.`);
    }

    if (snapshot.isGitRepository) {
      await markWorktreeLaneOpened(snapshot.repoRoot, laneId, mode).catch(() => null);
    }
    return {
      laneId,
      studioToken,
      url: `/?studioToken=${studioToken}`
    };
  };

  const startConversation = async (request: ConversationStartRequest): Promise<LaneOpenResponse> => {
    const message = request.message.trim();
    if (!message) throw new Error("Write a message to start the conversation.");
    if (request.isolation !== "repository" && request.isolation !== "worktree") {
      throw new Error("Conversation isolation must be repository or worktree.");
    }
    if (!repoState.isGitRepository && request.isolation === "worktree") {
      throw new Error("Worktree isolation requires a Git repository. Start in the selected directory instead.");
    }
    const planLabel = deriveConversationPlanLabel(message);
    const planId = createConversationPlanId(planLabel);
    let opened: LaneOpenResponse;
    if (request.isolation === "worktree") {
      const created = await createWorktreeLane(repoState.currentWorkspace, { planId, mode: "prepare" });
      opened = await openLane(created.lane.laneId, "prepare", undefined, planId, false);
    } else {
      opened = await openLane("current", "prepare", undefined, planId, false);
    }
    const studio = sessions.get(opened.studioToken);
    if (!studio) throw new Error("The conversation could not be opened.");
    await studio.startPromise;
    await studio.controller.dispatch({ type: "session-rename", title: "New conversation" });
    return opened;
  };

  const openSession = async (sessionId: string): Promise<LaneOpenResponse> => {
    const record = await agentSessionStore.load(repoId, sessionId);
    if (!record || record.lifecycle === "deleted") throw new Error("That session is no longer available.");
    const currentBinding = [...record.workspaceBindings].reverse().find((binding) => !binding.retiredAt);
    if (!currentBinding) {
      throw new Error("This session's worktree has been retired. Fork it into a new worktree before resuming.");
    }
    return openLane(
      currentBinding.laneId,
      record.planId ? "prepare" : "operate",
      record.sessionId,
      record.planId ?? undefined,
      currentBinding.laneId !== "current"
    );
  };

  const forkSessionIntoWorktree = async (sessionId: string): Promise<LaneOpenResponse> => {
    if (!repoState.isGitRepository) throw new Error("Worktrees require a Git repository.");
    const parent = await agentSessionStore.load(repoId, sessionId);
    if (!parent || parent.lifecycle === "deleted") throw new Error("That session is no longer available.");
    if (!parent.planId) throw new Error("A session needs a plan id before it can create a worktree.");
    const latestBinding = parent.workspaceBindings.at(-1);
    const created = await createWorktreeLane(repoState.currentWorkspace, {
      planId: parent.planId,
      mode: "prepare",
      baseRef: latestBinding?.branchName ?? undefined
    });
    await copyConversationPlan(parent.workspace, created.workspace, parent.planId);
    const forked = await agentSessionStore.create({
      providerId: parent.providerId,
      providerSessionId: parent.capabilities.includes("fork") ? parent.providerSessionId : null,
      parentSessionId: parent.sessionId,
      repoId,
      laneId: created.lane.laneId,
      workspace: created.workspace,
      planId: parent.planId,
      title: parent.title,
      model: parent.model,
      permissionMode: parent.permissionMode,
      capabilities: parent.capabilities,
      effectiveSkillHashes: parent.effectiveSkillHashes,
      branchName: created.lane.branchName,
      startingCommit: created.lane.head
    });
    return openLane(created.lane.laneId, "prepare", forked.sessionId, parent.planId, false);
  };

  const createLane = async (request: LaneCreateRequest): Promise<LaneOpenResponse> => {
    if (!repoState.isGitRepository) throw new Error("Worktrees require a Git repository.");
    if (!request.planId.trim()) {
      throw new Error("A plan id is required before creating a worktree lane.");
    }

    const created = await createWorktreeLane(repoState.currentWorkspace, {
      planId: request.planId,
      mode: request.mode
    });
    return openLane(created.lane.laneId, request.mode);
  };

  const archiveLane = async (laneId: string): Promise<void> => {
    const snapshot = await getRepoSnapshot();
    await archiveWorktreeLane(snapshot.repoRoot, laneId);
  };

  const removeLane = async (laneId: string): Promise<void> => {
    for (const [key, token] of workspaceTokens) {
      const session = sessions.get(token);
      if (session?.laneId !== laneId) continue;
      await session.controller.close();
      sessions.delete(token);
      workspaceTokens.delete(key);
    }
    await removeWorktreeLane(repoState.currentWorkspace, laneId);
  };

  const setLaneDeleteLock = async (laneId: string, deleteLocked: boolean): Promise<void> => {
    const snapshot = await getRepoSnapshot();
    await setWorktreeLaneDeleteLock(snapshot.repoRoot, laneId, deleteLocked);
  };

  const assessFinish = async (laneId: string): Promise<FinishWorkAssessment> => {
    const snapshot = await getRepoSnapshot();
    const lane = snapshot.lanes.find((entry) => entry.laneId === laneId && !entry.removed);
    if (!lane) throw new Error(`Unknown worktree lane \`${laneId}\`.`);
    const activeOperation = [...sessions.values()].some((session) => session.laneId === laneId && session.controller.getSnapshot().busy);
    return assessFinishWork(lane, snapshot.sessions, { activeOperation });
  };

  const finishLane = async (request: FinishWorkRequest): Promise<FinishWorkResult> => {
    if (!request.archiveSessions) throw new Error("Finish Work must preserve and archive bound sessions.");
    if (request.confirmation !== request.laneId) throw new Error(`Type \`${request.laneId}\` exactly to finish this worktree.`);
    const assessment = await assessFinish(request.laneId);
    if (!assessment.canArchive) throw new Error(assessment.blockers.join(" ") || "This worktree cannot be archived yet.");
    if (request.removeWorktree && !assessment.canRemoveWorktree) {
      throw new Error(assessment.removalBlockers.join(" ") || "This worktree is not safe to remove.");
    }

    for (const [key, token] of workspaceTokens) {
      const live = sessions.get(token);
      if (live?.laneId !== request.laneId) continue;
      await live.controller.close();
      sessions.delete(token);
      workspaceTokens.delete(key);
    }

    const snapshot = await getRepoSnapshot();
    const lane = snapshot.lanes.find((entry) => entry.laneId === request.laneId)!;
    const archivedSessionIds: string[] = [];
    if (request.archiveSessions) {
      for (const session of snapshot.sessions) {
        const ownsLane = session.workspaceBindings.some((binding) => binding.laneId === request.laneId && !binding.retiredAt);
        if (!ownsLane) continue;
        await agentSessionStore.append(repoId, session.sessionId, {
          kind: "workspace.retired",
          payload: {
            laneId: lane.laneId,
            workspace: lane.worktreePath,
            branchName: lane.branchName,
            endingCommit: lane.head,
            reason: request.removeWorktree ? "worktree-removed" : "work-finished",
            aheadCount: lane.aheadCount,
            behindCount: lane.behindCount,
            changedFileCount: lane.stagedCount + lane.unstagedCount + lane.untrackedCount,
            conflictCount: lane.conflictCount
          }
        });
        await agentSessionStore.retireWorkspace(repoId, session.sessionId, {
          endingCommit: lane.head,
          reason: request.removeWorktree ? "worktree-removed" : "work-finished"
        });
        await agentSessionStore.setArchived(repoId, session.sessionId, true);
        archivedSessionIds.push(session.sessionId);
      }
    }
    await archiveWorktreeLane(snapshot.repoRoot, request.laneId);
    if (request.removeWorktree) await removeWorktreeLane(repoState.currentWorkspace, request.laneId);
    return {
      laneId: request.laneId,
      archivedSessionIds,
      worktreeRemoved: request.removeWorktree,
      branchRetained: true
    };
  };

  const updateSession = async (sessionId: string, action: "pin" | "unpin" | "archive" | "restore" | "delete"): Promise<void> => {
    const record = await agentSessionStore.load(repoId, sessionId);
    if (!record) throw new Error("Unknown session.");
    if (action === "pin" || action === "unpin") await agentSessionStore.setPinned(repoId, sessionId, action === "pin");
    if (action === "archive") await agentSessionStore.setArchived(repoId, sessionId, true);
    if (action === "restore") {
      const latestBinding = record.workspaceBindings.at(-1);
      if (latestBinding?.retiredAt) {
        const snapshot = await getRepoSnapshot();
        const lane = snapshot.lanes.find((entry) => entry.laneId === latestBinding.laneId && !entry.removed && entry.lifecycle !== "missing");
        if (!lane) throw new Error("The original worktree was removed. Create a new worktree and fork this session to continue.");
        await agentSessionStore.bindWorkspace(repoId, sessionId, {
          laneId: lane.laneId,
          workspace: lane.worktreePath,
          branchName: lane.branchName,
          startingCommit: lane.head
        });
      }
      await agentSessionStore.setArchived(repoId, sessionId, false);
    }
    if (action === "delete") await agentSessionStore.setDeleted(repoId, sessionId, true);
  };

  return {
    getRepoSnapshot,
    async selectRepository() {
      throw new Error("Repository selection is only available from the dashboard host.");
    },
    selectAuthOption,
    installConnector,
    setConnectorEnabled,
    removeConnector,
    startConversation,
    createLane,
    openLane,
    openSession,
    forkSessionIntoWorktree,
    archiveLane,
    setLaneDeleteLock,
    removeLane,
    assessFinish,
    finishLane,
    updateSession,
    getStudioSession(token: string) {
      return sessions.get(token) ?? null;
    },
    async close() {
      for (const session of sessions.values()) {
        await session.controller.close();
      }
      sessions.clear();
      workspaceTokens.clear();
    }
  };
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    assetRoot: string;
    dashboardToken: string;
    host: WebStudioHost;
  }
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const dashboardToken = getRequestToken(url, request);
  const studioSession = dashboardToken ? context.host.getStudioSession(dashboardToken) : null;
  const isDashboardAuthorized = dashboardToken === context.dashboardToken;
  const isStudioAuthorized = Boolean(studioSession);
  const activeStudioSession = studioSession;

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = await readFile(path.join(context.assetRoot, "index.html"), "utf8");
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(html.replace("__SRGICAL_TOKEN__", context.dashboardToken));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/repo") {
    if (!isDashboardAuthorized) {
      return respondUnauthorized(response);
    }
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.getRepoSnapshot()));
    return;
  }

  if (request.method === "POST" && (url.pathname === "/api/workspaces/select" || url.pathname === "/api/repositories/select")) {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const body = await readJsonBody<{ path?: string }>(request);
    if (!body.path?.trim()) throw new Error("Choose a working directory.");
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.selectRepository(body.path)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings/provider") {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const body = await readJsonBody<{ authOptionId?: StudioAuthOptionId }>(request);
    if (!body.authOptionId) throw new Error("Authentication option id is required.");
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.selectAuthOption(body.authOptionId)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings/connectors/install") {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const body = await readJsonBody<{ presetId?: string }>(request);
    if (!body.presetId) throw new Error("Connector preset id is required.");
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.installConnector(body.presetId)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings/connectors/toggle") {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const body = await readJsonBody<{ connectorId?: string; enabled?: boolean }>(request);
    if (!body.connectorId || typeof body.enabled !== "boolean") {
      throw new Error("Connector id and enabled state are required.");
    }
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.setConnectorEnabled(body.connectorId, body.enabled)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings/connectors/remove") {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const body = await readJsonBody<{ connectorId?: string }>(request);
    if (!body.connectorId) throw new Error("Connector id is required.");
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.removeConnector(body.connectorId)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/conversations/start") {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const body = await readJsonBody<ConversationStartRequest>(request);
    response.statusCode = 202;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.startConversation(body)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/lanes/create") {
    if (!isDashboardAuthorized) {
      return respondUnauthorized(response);
    }
    const body = await readJsonBody<LaneCreateRequest>(request);
    response.statusCode = 202;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.createLane(body)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/lanes/open") {
    if (!isDashboardAuthorized) {
      return respondUnauthorized(response);
    }
    const body = await readJsonBody<{ laneId?: string; mode?: StudioMode }>(request);
    if (!body.laneId || !body.mode) {
      throw new Error("Lane id and mode are required.");
    }
    response.statusCode = 202;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.openLane(body.laneId, body.mode)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/lanes/archive") {
    if (!isDashboardAuthorized) {
      return respondUnauthorized(response);
    }
    const body = await readJsonBody<{ laneId?: string }>(request);
    if (!body.laneId) {
      throw new Error("Lane id is required.");
    }
    await context.host.archiveLane(body.laneId);
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/lanes/remove") {
    if (!isDashboardAuthorized) {
      return respondUnauthorized(response);
    }
    const body = await readJsonBody<{ laneId?: string }>(request);
    if (!body.laneId) {
      throw new Error("Lane id is required.");
    }
    await context.host.removeLane(body.laneId);
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/lanes/lock") {
    if (!isDashboardAuthorized) {
      return respondUnauthorized(response);
    }
    const body = await readJsonBody<{ laneId?: string; deleteLocked?: boolean }>(request);
    if (!body.laneId || typeof body.deleteLocked !== "boolean") {
      throw new Error("Lane id and deleteLocked are required.");
    }
    await context.host.setLaneDeleteLock(body.laneId, body.deleteLocked);
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/lanes/finish") {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const laneId = url.searchParams.get("laneId");
    if (!laneId) throw new Error("Lane id is required.");
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.assessFinish(laneId)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/lanes/finish") {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const body = await readJsonBody<FinishWorkRequest>(request);
    response.statusCode = 202;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.finishLane(body)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions/open") {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const body = await readJsonBody<{ sessionId?: string }>(request);
    if (!body.sessionId) throw new Error("Session id is required.");
    response.statusCode = 202;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.openSession(body.sessionId)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions/fork-worktree") {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const body = await readJsonBody<{ sessionId?: string }>(request);
    if (!body.sessionId) throw new Error("Session id is required.");
    response.statusCode = 202;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await context.host.forkSessionIntoWorktree(body.sessionId)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions/update") {
    if (!isDashboardAuthorized) return respondUnauthorized(response);
    const body = await readJsonBody<{
      sessionId?: string;
      action?: "pin" | "unpin" | "archive" | "restore" | "delete";
    }>(request);
    if (!body.sessionId || !body.action) throw new Error("Session id and action are required.");
    await context.host.updateSession(body.sessionId, body.action);
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/studio/session") {
    if (!isStudioAuthorized) {
      return respondUnauthorized(response);
    }
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(activeStudioSession!.controller.getSnapshot() satisfies StudioSnapshot));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/studio/directories") {
    if (!isStudioAuthorized) {
      return respondUnauthorized(response);
    }
    const requestedPath = url.searchParams.get("path") ?? "";
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(await listReferenceDirectoryOptions(activeStudioSession!.workspace, requestedPath)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/studio/input") {
    if (!isStudioAuthorized) {
      return respondUnauthorized(response);
    }
    const body = await readJsonBody<{ text?: string }>(request);
    await activeStudioSession!.controller.submitInput(body.text ?? "");
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/studio/action") {
    if (!isStudioAuthorized) {
      return respondUnauthorized(response);
    }
    const body = await readJsonBody<StudioActionRequest>(request);
    await activeStudioSession!.controller.dispatch(body);
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/studio/settings") {
    if (!isStudioAuthorized) {
      return respondUnauthorized(response);
    }
    const body = await readJsonBody<{ themeId?: string; announce?: boolean }>(request);
    await activeStudioSession!.controller.dispatch({ type: "theme", themeId: body.themeId, announce: body.announce });
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/studio/events") {
    if (!isStudioAuthorized) {
      return respondUnauthorized(response);
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    const unsubscribe = activeStudioSession!.controller.subscribe((event: StudioEvent) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    request.on("close", () => {
      unsubscribe?.();
    });
    return;
  }

  const relativePath = url.pathname.replace(/^\/+/, "");
  const filePath = path.join(context.assetRoot, relativePath);
  if (await fileExists(filePath)) {
    response.statusCode = 200;
    response.setHeader("content-type", contentTypeFor(filePath));
    response.end(await readFile(filePath));
    return;
  }

  response.statusCode = 404;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ error: "Not found." }));
}

async function resolveStudioWebAssetRoot(): Promise<string | null> {
  const candidates = [
    path.resolve(__dirname, "..", "..", "dist", "studio-web"),
    path.resolve(__dirname, "..", "..", "..", "studio-web", "dist")
  ];
  for (const candidate of candidates) {
    if (await fileExists(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

function respondUnauthorized(response: ServerResponse): void {
  response.statusCode = 401;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ error: "Unauthorized Studio session." }));
}

function getRequestToken(url: URL, request: IncomingMessage): string {
  const token = url.searchParams.get("token") ?? request.headers["x-srgical-token"];
  return Array.isArray(token) ? token[0] ?? "" : token ?? "";
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (filePath.endsWith(".png")) {
    return "image/png";
  }
  if (filePath.endsWith(".webmanifest")) {
    return "application/manifest+json; charset=utf-8";
  }
  return "application/octet-stream";
}

function normalizeRepositoryPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function resolveInitialWorkspace(explicitWorkspace?: string, historyHomeDir?: string): Promise<string> {
  if (explicitWorkspace?.trim()) {
    const resolved = path.resolve(explicitWorkspace);
    if (!await isDirectory(resolved)) throw new Error(`Working directory does not exist or is not a directory: ${resolved}`);
    return resolved;
  }
  const history = await loadRecentRepositories(historyHomeDir).catch(() => []);
  for (const entry of history) {
    if (await isDirectory(entry.path)) return entry.path;
  }
  return process.cwd();
}

async function isDirectory(candidate: string): Promise<boolean> {
  return stat(candidate).then((value) => value.isDirectory()).catch(() => false);
}

export function resolveStudioPort(explicitPort?: number, environmentPort?: string): number {
  const candidate = explicitPort ?? (environmentPort?.trim() ? Number(environmentPort) : 43111);
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > 65_535) {
    throw new Error("The Studio port must be an integer between 0 and 65535.");
  }
  return candidate;
}

function openUrl(url: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

export function deriveConversationPlanLabel(message: string): string {
  const firstLine = message.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, " ");
  if (firstLine.length <= 72) return firstLine;
  return `${firstLine.slice(0, 69).trimEnd()}...`;
}

export function createConversationPlanId(title: string): string {
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42)
    .replace(/-+$/g, "") || "conversation";
  return `${slug}-${randomBytes(3).toString("hex")}`;
}

async function copyConversationPlan(sourceWorkspace: string, destinationWorkspace: string, planId: string): Promise<void> {
  const source = path.join(sourceWorkspace, ".srgical", "plans", planId);
  const destination = path.join(destinationWorkspace, ".srgical", "plans", planId);
  await cp(source, destination, { recursive: true, force: false, errorOnExist: false }).catch((error) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    throw error;
  });
}
