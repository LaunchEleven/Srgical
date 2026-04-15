#!/usr/bin/env node

import { Command } from "commander";
import { runAboutCommand } from "./commands/about";
import { runChangelogCommand } from "./commands/changelog";
import { runDoctorCommand } from "./commands/doctor";
import { runInitCommand } from "./commands/init";
import { runOperateCommand } from "./commands/operate";
import { runPrepareCommand } from "./commands/prepare";
import { runRunNextCommand } from "./commands/run-next";
import { runStatusCommand } from "./commands/status";
import { runStudioConfigCommand } from "./commands/studio-config";
import { runStudioCommand, runStudioOperateCommand, runStudioPlanCommand } from "./commands/studio";
import { completeCliValues, renderCompletionScript } from "./core/completion";
import { readInstalledPackageInfo } from "./core/package-info";
import { resolveUpgradeNotice } from "./core/update-notice";
import { runVersionCommand } from "./commands/version";

const program = new Command();
const packageInfo = readInstalledPackageInfo();

program
  .name("srgical")
  .description("A polished local-first CLI for AI-assisted prepare and operate workflows.")
  .version(packageInfo.version, "-V, --version", "Show installed version and release info.");

program.command("version").description("Show installed version and release info.").action(() => { runVersionCommand(); });
program.command("about").description("Show package, release, and supported-agent information.").action(() => { runAboutCommand(); });
program.command("changelog").description("Show where to find upgrade notes for the installed version.").action(() => { runChangelogCommand(); });
program.command("completion").description("Print a shell completion script for bash or PowerShell.").argument("<shell>", "Shell name: bash or powershell").action((shell: string) => {
  process.stdout.write(renderCompletionScript(shell));
});

program.command("prepare").description("Open the immersive prepare flow for a named plan.")
  .argument("[plan]", "Plan id")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Plan id to prepare")
  .option("--web", "Launch the browser-based Studio renderer")
  .option("--terminal", "Force the terminal Studio renderer")
  .option("--no-open", "Start the web Studio without opening a browser")
  .action(async (planArg, workspaceArg, options: { plan?: string; web?: boolean; terminal?: boolean; noOpen?: boolean }) => {
    const planId = options.plan ?? planArg;
    await runPrepareCommand(workspaceArg, {
      planId,
      renderer: options.terminal ? "terminal" : options.web ? "web" : null,
      openBrowser: options.noOpen ? false : true
    });
  });

program.command("operate").description("Open the immersive operate flow or run the next step directly.")
  .argument("[plan]", "Plan id")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Plan id to operate")
  .option("--dry-run", "Preview the current operate prompt without invoking the agent")
  .option("--auto", "Continue executing eligible steps automatically")
  .option("--max-steps <n>", "Maximum number of auto iterations to attempt", Number)
  .option("--checkpoint", "Use explicit PR checkpoints instead of the default step mode")
  .option("--agent <id>", "Temporarily override the active agent for this run")
  .option("--web", "Launch the browser-based Studio renderer")
  .option("--terminal", "Force the terminal Studio renderer")
  .option("--no-open", "Start the web Studio without opening a browser")
  .action(async (planArg, workspaceArg, options: { plan?: string; dryRun?: boolean; auto?: boolean; maxSteps?: number; checkpoint?: boolean; agent?: string; web?: boolean; terminal?: boolean; noOpen?: boolean }) => {
    const planId = options.plan ?? planArg;
    await runOperateCommand(workspaceArg, {
      planId,
      dryRun: Boolean(options.dryRun),
      auto: Boolean(options.auto),
      maxSteps: options.maxSteps,
      checkpoint: Boolean(options.checkpoint),
      agent: options.agent,
      renderer: options.terminal ? "terminal" : options.web ? "web" : null,
      openBrowser: options.noOpen ? false : true
    });
  });

program.command("status").description("Show the non-interactive source of truth for the current plan state.")
  .argument("[plan]", "Plan id")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Plan id to inspect")
  .action(async (planArg, workspaceArg, options: { plan?: string }) => {
    const planId = options.plan ?? planArg;
    await runStatusCommand(workspaceArg, { planId });
  });

program.command("doctor").description("Legacy command kept only to explain the reboot.")
  .allowUnknownOption(true)
  .argument("[plan]")
  .argument("[workspace]")
  .action(async () => { await runDoctorCommand(); });
program.command("init").description("Legacy command kept only to explain the reboot.")
  .allowUnknownOption(true)
  .argument("[plan]")
  .argument("[workspace]")
  .action(async () => { await runInitCommand(); });
program.command("studio").description("Legacy command kept only to explain the reboot.")
  .allowUnknownOption(true)
  .argument("[plan]")
  .argument("[workspace]")
  .action(async () => { await runStudioCommand(); });
program.command("run-next").description("Legacy command kept only to explain the reboot.")
  .allowUnknownOption(true)
  .argument("[plan]")
  .argument("[workspace]")
  .action(async () => { await runRunNextCommand(); });
program.command("studio-plan").description("Legacy command kept only to explain the reboot.")
  .allowUnknownOption(true)
  .argument("[plan]")
  .argument("[workspace]")
  .action(async () => { await runStudioPlanCommand(); });
program.command("studio-operate").description("Legacy command kept only to explain the reboot.")
  .allowUnknownOption(true)
  .argument("[plan]")
  .argument("[workspace]")
  .action(async () => { await runStudioOperateCommand(); });
program.command("studio-config").description("Legacy command kept only to explain the reboot.")
  .allowUnknownOption(true)
  .argument("[plan]")
  .argument("[workspace]")
  .action(async () => { await runStudioConfigCommand(); });

void runCli();

async function runCli(): Promise<void> {
  try {
    const rawArgs = process.argv.slice(2);
    if (rawArgs[0] === "__complete") {
      const indexFlag = rawArgs.indexOf("--index");
      const separatorIndex = rawArgs.indexOf("--");
      const wordIndex = indexFlag >= 0 ? Number(rawArgs[indexFlag + 1]) : -1;
      const words = separatorIndex >= 0 ? rawArgs.slice(separatorIndex + 1) : [];
      const suggestions = await completeCliValues({
        words,
        wordIndex,
        cwd: process.cwd()
      });
      process.stdout.write(`${suggestions.join("\n")}\n`);
      return;
    }
    const upgradeNotice = rawArgs[0] === "completion" ? null : await resolveUpgradeNotice(packageInfo.version);
    if (upgradeNotice) {
      process.stdout.write(`${upgradeNotice}\n\n`);
    }
    await program.parseAsync(process.argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
