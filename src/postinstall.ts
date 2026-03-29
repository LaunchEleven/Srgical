import process from "node:process";
import { readInstalledPackageInfo } from "./core/package-info";
import { paintLine, renderCommandBanner, renderSectionHeading } from "./ui/terminal-theme";

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
    ...renderCommandBanner("srgical", "installed"),
    "",
    renderSectionHeading("Ready"),
    paintLine(`srgical ${info.version} is ready.`, "success", { bold: true }),
    info.releaseNotesUrl ? `Release notes: ${info.releaseNotesUrl}` : null,
    "",
    renderSectionHeading("Next"),
    paintLine("Start here: srgical doctor", "brand", { bold: true }),
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
