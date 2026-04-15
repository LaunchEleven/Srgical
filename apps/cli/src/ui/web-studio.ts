import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  createStudioController,
  type StudioActionRequest,
  type StudioEvent
} from "@srgical/studio-core";
import { STUDIO_THEMES, type StudioMode } from "@srgical/studio-shared";
import { fileExists } from "../core/workspace";

type LaunchWebStudioOptions = {
  workspace?: string;
  planId?: string | null;
  mode?: StudioMode;
  openBrowser?: boolean;
};

export async function launchWebStudio(options: LaunchWebStudioOptions = {}): Promise<void> {
  const assetRoot = await resolveStudioWebAssetRoot();
  if (!assetRoot) {
    throw new Error("The Studio web bundle is not built yet. Run `npm run build` before launching the web UI.");
  }

  const controller = await createStudioController(options);
  await controller.start();

  const token = randomBytes(24).toString("hex");
  const server = createServer(async (request, response) => {
    try {
      await routeRequest(request, response, { assetRoot, controller, token });
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

  const url = `http://127.0.0.1:${address.port}/?token=${token}`;
  process.stdout.write(`Studio web UI: ${url}\n`);
  if (options.openBrowser !== false) {
    openUrl(url);
  }

  const shutdown = async () => {
    await controller.close();
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

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    assetRoot: string;
    controller: Awaited<ReturnType<typeof createStudioController>>;
    token: string;
  }
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const requiresAuth = url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/api/");
  if (requiresAuth && !isAuthorized(url, request, context.token)) {
    response.statusCode = 401;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "Unauthorized Studio session." }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(context.controller.getSnapshot()));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/settings") {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ settings: context.controller.getSnapshot().settings, themes: STUDIO_THEMES }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/input") {
    const body = await readJsonBody<{ text?: string }>(request);
    await context.controller.submitInput(body.text ?? "");
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/action") {
    const body = await readJsonBody<StudioActionRequest>(request);
    await context.controller.dispatch(body);
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    const body = await readJsonBody<{ themeId?: string }>(request);
    await context.controller.dispatch({ type: "theme", themeId: body.themeId });
    response.statusCode = 202;
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    const unsubscribe = context.controller.subscribe((event: StudioEvent) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    request.on("close", () => {
      unsubscribe();
    });
    return;
  }

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = await readFile(path.join(context.assetRoot, "index.html"), "utf8");
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(html.replace("__SRGICAL_TOKEN__", context.token));
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

function isAuthorized(url: URL, request: IncomingMessage, token: string): boolean {
  const requestToken = url.searchParams.get("token") ?? request.headers["x-srgical-token"];
  return requestToken === token;
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
