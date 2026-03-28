import process from "node:process";
import { readInstalledPackageInfo } from "./core/package-info";

if (require.main === module) {
  runPostinstall();
}

export function runPostinstall(): void {
  if (shouldRenderPostinstallMessage(process.env, process.stdout.isTTY === true)) {
    process.stdout.write(`${renderPostinstallMessage()}\n`);
  }
}

export function renderPostinstallMessage(): string {
  const info = readInstalledPackageInfo();

  return [
    "",
    `srgical ${info.version} is ready.`,
    info.releaseNotesUrl ? `Release notes: ${info.releaseNotesUrl}` : null,
    "Start here: srgical doctor",
    "More: srgical about",
    ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function shouldRenderPostinstallMessage(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  const globalInstall = env.npm_config_global === "true" || env.npm_config_location === "global";
  const logLevel = (env.npm_config_loglevel ?? "").toLowerCase();
  const quietLogLevel = logLevel === "silent" || logLevel === "error";

  return globalInstall && isTTY && env.CI !== "true" && !quietLogLevel;
}
