import process from "node:process";
import {
  installShellCompletionProfiles,
  renderCompletionInstallSummary,
  type CompletionInstallResult
} from "./core/completion-install";
import { readInstalledPackageInfo } from "./core/package-info";
import { paintLine, renderCommandBanner, renderSectionHeading } from "./ui/terminal-theme";

if (require.main === module) {
  void runPostinstall();
}

type PostinstallRuntime = {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  write?: (output: string) => void;
  installProfiles?: () => Promise<CompletionInstallResult>;
};

export async function runPostinstall(runtime: PostinstallRuntime = {}): Promise<void> {
  const env = runtime.env ?? process.env;
  const isTTY = runtime.isTTY ?? (process.stdout.isTTY === true);

  if (!shouldRenderPostinstallMessage(env, isTTY)) {
    return;
  }

  let completionSummary: string | null = null;
  if (env.SRGICAL_DISABLE_PROFILE_INSTALL !== "true") {
    try {
      const result = await (runtime.installProfiles ?? installShellCompletionProfiles)();
      completionSummary = renderCompletionInstallSummary(result);
    } catch {
      completionSummary = "Shell completion: automatic profile setup failed";
    }
  }

  (runtime.write ?? process.stdout.write.bind(process.stdout))(`${renderPostinstallMessage(completionSummary)}\n`);
}

export function renderPostinstallMessage(completionSummary?: string | null): string {
  const info = readInstalledPackageInfo();

  return [
    ...renderCommandBanner("srgical", "installed"),
    "",
    renderSectionHeading("Ready"),
    paintLine(`srgical ${info.version} is ready.`, "success", { bold: true }),
    info.releaseNotesUrl ? `Release notes: ${info.releaseNotesUrl}` : null,
    completionSummary ? paintLine(completionSummary, "info") : null,
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
