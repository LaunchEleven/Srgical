import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { paintLine, renderSectionHeading } from "../ui/terminal-theme";

const UPDATE_CACHE_VERSION = 1;
const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 1200;
const PUBLIC_NPM_PACKAGE_NAME = "@launch11/srgical";
const PUBLIC_NPM_INSTALL_COMMAND = "npm i -g @launch11/srgical";

type UpdateNoticeCache = {
  version: 1;
  installedVersion: string;
  latestVersion: string | null;
  checkedAt: string;
  notifiedInstalledVersion?: string | null;
  notifiedLatestVersion?: string | null;
};

type UpdateNoticeRuntime = {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  platform?: NodeJS.Platform;
  homedir?: string;
  now?: () => Date;
  fetchLatestVersion?: (packageName: string, timeoutMs: number) => Promise<string>;
  onCacheWrite?: (filePath: string) => void;
};

export async function resolveUpgradeNotice(
  installedVersion: string,
  runtime: UpdateNoticeRuntime = {}
): Promise<string | null> {
  const env = runtime.env ?? process.env;
  const isTTY = runtime.isTTY ?? process.stdout.isTTY === true;

  if (!shouldCheckForUpgradeNotice(env, isTTY)) {
    return null;
  }

  const platform = runtime.platform ?? process.platform;
  const homedir = runtime.homedir ?? os.homedir();
  const now = runtime.now ?? (() => new Date());
  const cacheFile = getUpdateCheckCacheFilePath(platform, env, homedir);
  const fetchLatestVersion = runtime.fetchLatestVersion ?? fetchLatestPublishedVersion;
  const nowValue = now();
  const existingCache = await readUpdateCache(cacheFile);
  let nextCache = existingCache;
  let refreshedCache = false;

  if (shouldRefreshUpdateCache(existingCache, installedVersion, nowValue)) {
    try {
      const latestVersion = await fetchLatestVersion(PUBLIC_NPM_PACKAGE_NAME, UPDATE_CHECK_TIMEOUT_MS);
      nextCache = {
        version: UPDATE_CACHE_VERSION,
        installedVersion,
        latestVersion,
        checkedAt: nowValue.toISOString(),
        notifiedInstalledVersion: null,
        notifiedLatestVersion: null
      };
      refreshedCache = true;
    } catch {
      nextCache = existingCache;
    }
  }

  if (!nextCache?.latestVersion || compareReleaseVersions(nextCache.latestVersion, installedVersion) <= 0) {
    if (nextCache && (refreshedCache || shouldPersistCurrentVersion(nextCache, installedVersion, nowValue))) {
      await writeUpdateCache(
        cacheFile,
        {
          version: UPDATE_CACHE_VERSION,
          installedVersion,
          latestVersion: nextCache.latestVersion,
          checkedAt: nextCache.checkedAt,
          notifiedInstalledVersion: null,
          notifiedLatestVersion: null
        },
        runtime.onCacheWrite
      );
    }

    return null;
  }

  if (
    nextCache.notifiedInstalledVersion === installedVersion &&
    nextCache.notifiedLatestVersion === nextCache.latestVersion
  ) {
    return null;
  }

  await writeUpdateCache(
    cacheFile,
    {
      version: UPDATE_CACHE_VERSION,
      installedVersion,
      latestVersion: nextCache.latestVersion,
      checkedAt: nextCache.checkedAt,
      notifiedInstalledVersion: installedVersion,
      notifiedLatestVersion: nextCache.latestVersion
    },
    runtime.onCacheWrite
  );

  return renderUpgradeNotice(installedVersion, nextCache.latestVersion);
}

export function shouldCheckForUpgradeNotice(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  const logLevel = (env.npm_config_loglevel ?? "").toLowerCase();
  const quietLogLevel = logLevel === "silent" || logLevel === "error";

  return isTTY && env.CI !== "true" && env.SRGICAL_DISABLE_UPDATE_CHECK !== "true" && !quietLogLevel;
}

export function renderUpgradeNotice(installedVersion: string, latestVersion: string): string {
  return [
    renderSectionHeading("Upgrade"),
    paintLine(`Upgrade available: installed ${installedVersion}, latest ${latestVersion}.`, "warning", { bold: true }),
    `Run: ${PUBLIC_NPM_INSTALL_COMMAND}`
  ].join("\n");
}

export function compareReleaseVersions(left: string, right: string): number {
  const leftVersion = parseReleaseVersion(left);
  const rightVersion = parseReleaseVersion(right);

  if (!leftVersion || !rightVersion) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  }

  for (let index = 0; index < 3; index += 1) {
    const delta = leftVersion.core[index] - rightVersion.core[index];

    if (delta !== 0) {
      return delta;
    }
  }

  const leftPre = leftVersion.prerelease;
  const rightPre = rightVersion.prerelease;

  if (leftPre.length === 0 && rightPre.length === 0) {
    return 0;
  }

  if (leftPre.length === 0) {
    return 1;
  }

  if (rightPre.length === 0) {
    return -1;
  }

  const length = Math.max(leftPre.length, rightPre.length);

  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftPre[index];
    const rightIdentifier = rightPre[index];

    if (leftIdentifier === undefined) {
      return -1;
    }

    if (rightIdentifier === undefined) {
      return 1;
    }

    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);

    if (leftNumeric && rightNumeric) {
      const delta = Number(leftIdentifier) - Number(rightIdentifier);

      if (delta !== 0) {
        return delta;
      }

      continue;
    }

    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }

    const delta = leftIdentifier.localeCompare(rightIdentifier);

    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function getUpdateCheckCacheFilePath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, homedir: string): string {
  if (platform === "win32") {
    const stateRoot = env.LOCALAPPDATA || env.APPDATA || path.join(homedir, "AppData", "Local");
    return path.join(stateRoot, "srgical", "update-check.json");
  }

  if (platform === "darwin") {
    return path.join(homedir, "Library", "Application Support", "srgical", "update-check.json");
  }

  const stateRoot = env.XDG_STATE_HOME || path.join(homedir, ".local", "state");
  return path.join(stateRoot, "srgical", "update-check.json");
}

async function readUpdateCache(filePath: string): Promise<UpdateNoticeCache | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<UpdateNoticeCache>;

    if (parsed.version !== UPDATE_CACHE_VERSION || typeof parsed.checkedAt !== "string") {
      return null;
    }

    return {
      version: UPDATE_CACHE_VERSION,
      installedVersion: typeof parsed.installedVersion === "string" ? parsed.installedVersion : "0.0.0",
      latestVersion: typeof parsed.latestVersion === "string" ? parsed.latestVersion : null,
      checkedAt: parsed.checkedAt,
      notifiedInstalledVersion: typeof parsed.notifiedInstalledVersion === "string" ? parsed.notifiedInstalledVersion : null,
      notifiedLatestVersion: typeof parsed.notifiedLatestVersion === "string" ? parsed.notifiedLatestVersion : null
    };
  } catch {
    return null;
  }
}

async function writeUpdateCache(
  filePath: string,
  cache: UpdateNoticeCache,
  onCacheWrite?: (filePath: string) => void
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(cache, null, 2), "utf8");
  onCacheWrite?.(filePath);
}

function shouldRefreshUpdateCache(cache: UpdateNoticeCache | null, installedVersion: string, now: Date): boolean {
  if (!cache) {
    return true;
  }

  if (cache.installedVersion !== installedVersion) {
    return true;
  }

  const checkedAtMs = Date.parse(cache.checkedAt);

  if (Number.isNaN(checkedAtMs)) {
    return true;
  }

  return now.getTime() - checkedAtMs >= UPDATE_CHECK_TTL_MS;
}

function shouldPersistCurrentVersion(cache: UpdateNoticeCache, installedVersion: string, now: Date): boolean {
  return (
    cache.installedVersion !== installedVersion ||
    (cache.notifiedInstalledVersion ?? null) !== null ||
    (cache.notifiedLatestVersion ?? null) !== null ||
    Number.isNaN(Date.parse(cache.checkedAt)) ||
    Date.parse(cache.checkedAt) > now.getTime()
  );
}

async function fetchLatestPublishedVersion(packageName: string, timeoutMs: number): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "srgical-update-check"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status}`);
  }

  const payload = (await response.json()) as { version?: unknown };

  if (typeof payload.version !== "string" || payload.version.trim().length === 0) {
    throw new Error("npm registry payload did not include a version");
  }

  return payload.version.trim();
}

function parseReleaseVersion(
  value: string
): {
  core: [number, number, number];
  prerelease: string[];
} | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());

  if (!match) {
    return null;
  }

  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : []
  };
}
