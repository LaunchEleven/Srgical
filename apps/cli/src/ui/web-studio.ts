import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  createStudioController,
  type LaneCreateRequest,
  type LaneOpenResponse,
  type RepoSnapshot,
  type StudioActionRequest,
  type StudioController,
  type StudioEvent,
  type StudioSnapshot
} from "@srgical/studio-core";
import type { StudioMode } from "@srgical/studio-shared";
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

type LaunchWebStudioOptions = {
  workspace?: string;
  planId?: string | null;
  mode?: StudioMode;
  openBrowser?: boolean;
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

type WebStudioHost = {
  getRepoSnapshot(): Promise<RepoSnapshot>;
  createLane(request: LaneCreateRequest): Promise<LaneOpenResponse>;
  openLane(laneId: string, mode: StudioMode): Promise<LaneOpenResponse>;
  archiveLane(laneId: string): Promise<void>;
  setLaneDeleteLock(laneId: string, deleteLocked: boolean): Promise<void>;
  removeLane(laneId: string): Promise<void>;
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

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
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
  const repoState = await resolveWorktreeLaneRepoState(options.workspace ?? process.cwd());
  const sessions = new Map<string, StudioSession>();
  const laneTokens = new Map<string, string>();

  const getRepoSnapshot = async (): Promise<RepoSnapshot> => {
    const nextRepoState = await resolveWorktreeLaneRepoState(repoState.currentWorkspace);
    return {
      repoRoot: nextRepoState.repoRoot,
      repoLabel: path.basename(nextRepoState.repoRoot) || nextRepoState.repoRoot,
      currentWorkspace: nextRepoState.currentWorkspace,
      requestedPlanId: options.planId ?? null,
      requestedMode: options.mode ?? null,
      lanes: nextRepoState.lanes
    };
  };

  const openLane = async (laneId: string, mode: StudioMode): Promise<LaneOpenResponse> => {
    const workspace = await resolveLaneWorkspacePath(repoState.currentWorkspace, laneId);
    if (!workspace) {
      throw new Error(`Unknown worktree lane \`${laneId}\`.`);
    }

    const snapshot = await getRepoSnapshot();
    const lane = snapshot.lanes.find((entry) => entry.laneId === laneId);
    if (!lane) {
      throw new Error(`Unknown worktree lane \`${laneId}\`.`);
    }
    const planId = lane.planId ?? options.planId;
    if (!planId) {
      throw new Error(`Lane \`${laneId}\` does not have a plan id yet.`);
    }

    let studioToken = laneTokens.get(laneId);
    let session = studioToken ? sessions.get(studioToken) ?? null : null;
    if (!session || session.mode !== mode || session.planId !== planId || session.workspace !== workspace) {
      if (session) {
        await session.controller.close();
        sessions.delete(session.token);
      }
      studioToken = randomBytes(24).toString("hex");
      laneTokens.set(laneId, studioToken);
      const controller = await createStudioController({
        workspace,
        planId,
        mode,
        repoRoot: snapshot.repoRoot,
        laneId
      });
      const startPromise = controller.start().catch(async () => {
        await controller.close().catch(() => undefined);
        if (laneTokens.get(laneId) === studioToken) {
          laneTokens.delete(laneId);
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
    }

    if (!studioToken) {
      throw new Error(`Failed to create a Studio session token for lane \`${laneId}\`.`);
    }

    await markWorktreeLaneOpened(snapshot.repoRoot, laneId, mode).catch(() => null);
    return {
      laneId,
      studioToken,
      url: `/?studioToken=${studioToken}`
    };
  };

  const createLane = async (request: LaneCreateRequest): Promise<LaneOpenResponse> => {
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
    const token = laneTokens.get(laneId);
    if (token) {
      const session = sessions.get(token);
      if (session) {
        await session.controller.close();
        sessions.delete(token);
      }
      laneTokens.delete(laneId);
    }
    await removeWorktreeLane(repoState.currentWorkspace, laneId);
  };

  const setLaneDeleteLock = async (laneId: string, deleteLocked: boolean): Promise<void> => {
    const snapshot = await getRepoSnapshot();
    await setWorktreeLaneDeleteLock(snapshot.repoRoot, laneId, deleteLocked);
  };

  return {
    getRepoSnapshot,
    createLane,
    openLane,
    archiveLane,
    setLaneDeleteLock,
    removeLane,
    getStudioSession(token: string) {
      return sessions.get(token) ?? null;
    },
    async close() {
      for (const session of sessions.values()) {
        await session.controller.close();
      }
      sessions.clear();
      laneTokens.clear();
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
  return "application/octet-stream";
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
