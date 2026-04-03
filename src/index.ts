#!/usr/bin/env node

import { Command } from "commander";
import { runAboutCommand } from "./commands/about";
import { runChangelogCommand } from "./commands/changelog";
import { runDoctorCommand } from "./commands/doctor";
import { runInitCommand } from "./commands/init";
import { runRunNextCommand } from "./commands/run-next";
import { runStudioConfigCommand } from "./commands/studio-config";
import { runStudioOperateCommand, runStudioPlanCommand } from "./commands/studio";
import { resolveWorkspacePlanArgs } from "./core/cli-args";
import { completeCliValues, renderCompletionScript } from "./core/completion";
import { resolveUpgradeNotice } from "./core/update-notice";
import { runVersionCommand } from "./commands/version";
import { readInstalledPackageInfo } from "./core/package-info";

const program = new Command();
const packageInfo = readInstalledPackageInfo();

program
  .name("srgical")
  .description("Local-first AI planning and execution orchestration.")
  .version(packageInfo.version, "-V, --version", "Show installed version and release info.");

program
  .command("version")
  .description("Show installed version and release info.")
  .action(() => {
    runVersionCommand();
  });

program
  .command("about")
  .description("Show package, release, and supported-agent information.")
  .action(() => {
    runAboutCommand();
  });

program
  .command("changelog")
  .description("Show where to find upgrade notes for the installed version.")
  .action(() => {
    runChangelogCommand();
  });

program
  .command("completion")
  .description("Print a shell completion script for bash or PowerShell.")
  .argument("<shell>", "Shell name: bash or powershell")
  .action((shell: string) => {
    process.stdout.write(renderCompletionScript(shell));
  });

program
  .command("doctor")
  .description("Inspect the workspace and local agent availability.")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Planning pack id to inspect")
  .action(async (workspace, options: { plan?: string }) => {
    const resolved = resolveWorkspacePlanArgs(workspace, options.plan);
    await runDoctorCommand(resolved.workspace, { planId: resolved.planId });
  });

program
  .command("init")
  .description("Create a named local .srgical planning pack scaffold.")
  .argument("[workspace]", "Workspace path")
  .option("-f, --force", "Overwrite an existing planning pack")
  .option("--plan <id>", "Named planning pack id to create or overwrite")
  .action(async (workspace, options: { force?: boolean; plan?: string }) => {
    const resolved = resolveWorkspacePlanArgs(workspace, options.plan);
    await runInitCommand(resolved.workspace, Boolean(options.force), resolved.planId);
  });

const studioCommand = program
  .command("studio")
  .description("Open studio experiences for planning, operation, and operate-mode config.")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Planning pack id to use")
  .action(async (workspace, options: { plan?: string }) => {
    const resolved = resolveWorkspacePlanArgs(workspace, options.plan);
    await runStudioPlanCommand(resolved.workspace, { planId: resolved.planId });
  });

studioCommand
  .command("plan")
  .description("Open the planning studio.")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Planning pack id to open")
  .action(async (workspace, options: { plan?: string }, command: Command) => {
    const parentPlan = command.parent?.opts<{ plan?: string }>().plan;
    const resolved = resolveWorkspacePlanArgs(workspace, options.plan ?? parentPlan);
    await runStudioPlanCommand(resolved.workspace, { planId: resolved.planId });
  });

studioCommand
  .command("operate")
  .description("Open the operate studio for execution automation.")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Planning pack id to operate")
  .action(async (workspace, options: { plan?: string }, command: Command) => {
    const parentPlan = command.parent?.opts<{ plan?: string }>().plan;
    const resolved = resolveWorkspacePlanArgs(workspace, options.plan ?? parentPlan);
    await runStudioOperateCommand(resolved.workspace, { planId: resolved.planId });
  });

studioCommand
  .command("config")
  .description("Show or update operate-mode config (pause-for-PR + guidance references).")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Planning pack id to configure")
  .option("--pause-pr", "Enable pause-for-PR checkpoints between operate iterations")
  .option("--no-pause-pr", "Disable pause-for-PR checkpoints")
  .option("--set-reference <path>", "Replace reference guidance paths (repeatable)", collectPathOption, [])
  .option("--add-reference <path>", "Append a reference guidance path (repeatable)", collectPathOption, [])
  .option("--clear-references", "Clear all reference guidance paths")
  .action(
    async (
      workspace,
      options: {
        plan?: string;
        pausePr?: boolean;
        setReference?: string[];
        addReference?: string[];
        clearReferences?: boolean;
      },
      command: Command
    ) => {
      const parentPlan = command.parent?.opts<{ plan?: string }>().plan;
      const resolved = resolveWorkspacePlanArgs(workspace, options.plan ?? parentPlan);
      await runStudioConfigCommand(resolved.workspace, {
        planId: resolved.planId,
        pausePr: options.pausePr,
        setReference: options.setReference,
        addReference: options.addReference,
        clearReferences: Boolean(options.clearReferences)
      });
    }
  );

program
  .command("ssp")
  .description("Shortcut for `srgical studio plan`.")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Planning pack id to open")
  .action(async (workspace, options: { plan?: string }) => {
    const resolved = resolveWorkspacePlanArgs(workspace, options.plan);
    await runStudioPlanCommand(resolved.workspace, { planId: resolved.planId });
  });

program
  .command("sso")
  .description("Shortcut for `srgical studio operate`.")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Planning pack id to operate")
  .action(async (workspace, options: { plan?: string }) => {
    const resolved = resolveWorkspacePlanArgs(workspace, options.plan);
    await runStudioOperateCommand(resolved.workspace, { planId: resolved.planId });
  });

program
  .command("ssc")
  .description("Shortcut for `srgical studio config`.")
  .argument("[workspace]", "Workspace path")
  .option("--plan <id>", "Planning pack id to configure")
  .option("--pause-pr", "Enable pause-for-PR checkpoints between operate iterations")
  .option("--no-pause-pr", "Disable pause-for-PR checkpoints")
  .option("--set-reference <path>", "Replace reference guidance paths (repeatable)", collectPathOption, [])
  .option("--add-reference <path>", "Append a reference guidance path (repeatable)", collectPathOption, [])
  .option("--clear-references", "Clear all reference guidance paths")
  .action(
    async (
      workspace,
      options: {
        plan?: string;
        pausePr?: boolean;
        setReference?: string[];
        addReference?: string[];
        clearReferences?: boolean;
      }
    ) => {
      const resolved = resolveWorkspacePlanArgs(workspace, options.plan);
      await runStudioConfigCommand(resolved.workspace, {
        planId: resolved.planId,
        pausePr: options.pausePr,
        setReference: options.setReference,
        addReference: options.addReference,
        clearReferences: Boolean(options.clearReferences)
      });
    }
  );

program
  .command("run-next")
  .description("Run the current execution handoff through the active agent adapter.")
  .argument("[workspace]", "Workspace path")
  .option("--dry-run", "Preview the current execution prompt without invoking the active agent")
  .option("--agent <id>", "Temporarily override the active agent for this run only")
  .option("--plan <id>", "Planning pack id to execute")
  .option("--auto", "Continue executing eligible execution steps until a stop condition is reached")
  .option("--max-steps <n>", "Maximum number of auto iterations to attempt", Number)
  .action(async (workspace, options: { dryRun?: boolean; agent?: string; plan?: string; auto?: boolean; maxSteps?: number }) => {
    await runRunNextCommand(workspace, {
      dryRun: Boolean(options.dryRun),
      agent: options.agent,
      planId: options.plan,
      auto: Boolean(options.auto),
      maxSteps: options.maxSteps
    });
  });

void runCli();

function isStandaloneVersionRequest(args: string[]): boolean {
  return args.length === 1 && (args[0] === "--version" || args[0] === "-V");
}

function collectPathOption(value: string, previous: string[]): string[] {
  const segments = value
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return [...previous, ...segments];
}

async function runCli(): Promise<void> {
  try {
    const rawArgs = process.argv.slice(2);

    if (rawArgs[0] === "__complete") {
      await runHiddenCompletion(rawArgs.slice(1));
      return;
    }

    const upgradeNotice = shouldSkipUpgradeNotice(rawArgs) ? null : await resolveUpgradeNotice(packageInfo.version);

    if (upgradeNotice) {
      process.stdout.write(`${upgradeNotice}\n\n`);
    }

    if (isStandaloneVersionRequest(rawArgs)) {
      runVersionCommand();
      process.exit(0);
    }

    await program.parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

function shouldSkipUpgradeNotice(args: string[]): boolean {
  const command = args[0] ?? "";
  return command === "completion";
}

async function runHiddenCompletion(args: string[]): Promise<void> {
  const separatorIndex = args.indexOf("--");
  const optionArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
  const words = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];
  const indexFlag = optionArgs.indexOf("--index");

  if (indexFlag < 0 || indexFlag + 1 >= optionArgs.length) {
    throw new Error("Missing required completion option `--index <n>`.");
  }

  const wordIndex = Number(optionArgs[indexFlag + 1]);

  if (!Number.isInteger(wordIndex) || wordIndex < 0) {
    throw new Error("Completion index must be a non-negative integer.");
  }

  const suggestions = await completeCliValues({
    words,
    wordIndex,
    cwd: process.cwd()
  });

  if (suggestions.length > 0) {
    process.stdout.write(`${suggestions.join("\n")}\n`);
  }
}
