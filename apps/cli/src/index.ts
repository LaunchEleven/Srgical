#!/usr/bin/env node

import { Command } from "commander";
import { runAboutCommand } from "./commands/about";
import { runChangelogCommand } from "./commands/changelog";
import { readInstalledPackageInfo } from "./core/package-info";
import { resolveUpgradeNotice } from "./core/update-notice";
import { runVersionCommand } from "./commands/version";
import { launchWebStudio } from "./ui/web-studio";

const program = new Command();
const packageInfo = readInstalledPackageInfo();
const RETIRED_TERMINAL_COMMANDS = new Set([
  "prepare",
  "operate",
  "status",
  "doctor",
  "init",
  "studio",
  "run-next",
  "studio-plan",
  "studio-operate",
  "studio-config",
  "completion"
]);

program
  .name("srgical")
  .description("A browser-first local workspace for AI-assisted planning and delivery.")
  .version(packageInfo.version, "-V, --version", "Show installed version and release info.")
  .argument("[workspace]", "Repository or working directory to open (defaults to the last used workspace)")
  .option("--port <number>", "Stable localhost port for the browser Studio", Number)
  .option("--no-open", "Start the browser Studio without opening a browser")
  .action(async (workspace: string | undefined, options: { open?: boolean; port?: number }) => {
    if (workspace && RETIRED_TERMINAL_COMMANDS.has(workspace)) {
      throw new Error(`The \`${workspace}\` terminal workflow has been retired. Run \`srgical [working-directory]\` and continue in the browser.`);
    }
    await launchWebStudio({ workspace, port: options.port, openBrowser: options.open !== false });
  });

program.command("version").description("Show installed version and release info.").action(() => { runVersionCommand(); });
program.command("about").description("Show package, release, and supported-agent information.").action(() => { runAboutCommand(); });
program.command("changelog").description("Show where to find upgrade notes for the installed version.").action(() => { runChangelogCommand(); });

void runCli();

async function runCli(): Promise<void> {
  try {
    const rawArgs = process.argv.slice(2);
    if (rawArgs[0] && RETIRED_TERMINAL_COMMANDS.has(rawArgs[0])) {
      throw new Error(`The \`${rawArgs[0]}\` terminal workflow has been retired. Run \`srgical [working-directory]\` and continue in the browser.`);
    }
    const upgradeNotice = await resolveUpgradeNotice(packageInfo.version);
    if (upgradeNotice) {
      process.stdout.write(`${upgradeNotice}\n\n`);
    }
    await program.parseAsync(process.argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
