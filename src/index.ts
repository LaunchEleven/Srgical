#!/usr/bin/env node

import { Command } from "commander";
import { runDoctorCommand } from "./commands/doctor";
import { runInitCommand } from "./commands/init";
import { runRunNextCommand } from "./commands/run-next";
import { runStudioCommand } from "./commands/studio";

const program = new Command();

program
  .name("srgical")
  .description("Local-first AI planning and execution orchestration.")
  .version("0.1.0");

program
  .command("doctor")
  .description("Inspect the workspace and local agent availability.")
  .argument("[workspace]", "Workspace path")
  .action(async (workspace) => {
    await runDoctorCommand(workspace);
  });

program
  .command("init")
  .description("Create a local .srgical planning pack scaffold.")
  .argument("[workspace]", "Workspace path")
  .option("-f, --force", "Overwrite an existing planning pack")
  .action(async (workspace, options: { force?: boolean }) => {
    await runInitCommand(workspace, Boolean(options.force));
  });

program
  .command("studio")
  .description("Open the planning studio.")
  .argument("[workspace]", "Workspace path")
  .action(async (workspace) => {
    await runStudioCommand(workspace);
  });

program
  .command("run-next")
  .description("Run the current next-agent prompt through the active agent adapter.")
  .argument("[workspace]", "Workspace path")
  .option("--dry-run", "Preview the current execution prompt without invoking the active agent")
  .option("--agent <id>", "Temporarily override the active agent for this run only")
  .action(async (workspace, options: { dryRun?: boolean; agent?: string }) => {
    await runRunNextCommand(workspace, { dryRun: Boolean(options.dryRun), agent: options.agent });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
