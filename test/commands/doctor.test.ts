import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runDoctorCommand } from "../../src/commands/doctor";
import {
  resetAgentAdaptersForTesting,
  setAgentAdaptersForTesting,
  type AgentAdapter,
  type AgentStatus
} from "../../src/core/agent";
import type { ChatMessage } from "../../src/core/prompts";
import { saveStoredActiveAgentId } from "../../src/core/studio-session";
import { getPlanningPackPaths, readActivePlanId, writeText } from "../../src/core/workspace";
import { captureStdout } from "../helpers/capture";
import { createTempWorkspace, writePlanningPack } from "../helpers/workspace";

test("doctor reports all supported agents and the queued next step", async (t) => {
  const workspace = await createTempWorkspace("srgical-doctor-next-");
  const paths = await writePlanningPack(workspace);

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex", "0.113.0")
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: availableStatus("claude", "Claude Code", "1.2.3")
    }),
    createFakeAdapter({
      id: "augment",
      label: "Augment CLI",
      status: availableStatus("augment", "Augment CLI", "2.0.0")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  await saveStoredActiveAgentId(workspace, "claude");

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`PACK002\`
- Next Recommended: \`EXEC001\`
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`

## Execution

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC001 | pending | PACK002 | Summarize the next step. | The next step is visible before execution. | Pending command output work. |
`
  );

  await writeText(
    getPlanningPackPaths(workspace, { planId: paths.planId }).adviceState,
    JSON.stringify(
      {
        version: 1,
        planId: "default",
        updatedAt: "2026-03-24T00:05:00.000Z",
        problemStatement: "Summarize the queued execution work before running it.",
        clarity: "mostly clear",
        stateAssessment: "The execution target is visible, but validation expectations still need to be tightened.",
        researchNeeded: ["confirm validation command", "confirm expected output surface"],
        advice: "Tighten the acceptance language before the first execution handoff.",
        nextAction: "Review EXEC001 acceptance and then run the step."
      },
      null,
      2
    )
  );

  const output = await captureStdout(async () => {
    await runDoctorCommand(workspace);
  });

  assert.match(output, /Active plan: default/);
  assert.match(output, /Active agent: Claude Code \(claude\) - available \(1\.2\.3\)/);
  assert.match(output, /Supported agents:/);
  assert.match(output, /- Codex \(codex\): available \(0\.113\.0\) via codex\.cmd/);
  assert.match(output, /- Claude Code \(claude\) \[active\]: available \(1\.2\.3\) via claude\.cmd/);
  assert.match(output, /- Augment CLI \(augment\): available \(2\.0\.0\) via augment\.cmd/);
  assert.match(output, /Plans:/);
  assert.match(
    output,
    /default \[active\]: \| path \.srgical\/plans\/default \| mode Execution Active \| docs 1\/5 \| human write gate pending \| readiness 1\/5 \| execution started \| auto idle/
  );
  assert.match(output, /Next Step: EXEC001 \(Execution\)/);
  assert.match(output, /Docs present: 1\/5/);
  assert.match(output, /AI advice: Summarize the queued execution work before running it\./);
  assert.match(output, /Clarity: mostly clear/);
  assert.match(output, /Research: confirm validation command, confirm expected output surface/);
  assert.match(output, /Next: Review EXEC001 acceptance and then run the step\./);
  assert.match(
    output,
    /Next move: run `srgical studio operate --plan <id>` \(or `srgical sso --plan <id>`\) for guided automation, or `srgical run-next --plan <id>` for direct execution\./
  );
});

test("doctor reports missing supported agents safely when no next step is queued", async (t) => {
  const workspace = await createTempWorkspace("srgical-doctor-none-");
  const paths = await writePlanningPack(workspace);

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: unavailableStatus("codex", "Codex", "missing codex")
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: unavailableStatus("claude", "Claude Code", "missing claude")
    }),
    createFakeAdapter({
      id: "augment",
      label: "Augment CLI",
      status: unavailableStatus("augment", "Augment CLI", "missing augment")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  await writeText(
    paths.tracker,
    `# Detailed Implementation Plan

## Current Position

- Last Completed: \`DIST001\`
- Next Recommended: none queued
- Updated At: \`2026-03-24T00:00:00.000Z\`
- Updated By: \`Codex\`
`
  );

  const output = await captureStdout(async () => {
    await runDoctorCommand(workspace);
  });

  assert.match(output, /Active agent: Codex \(codex\) - missing \(missing codex\)/);
  assert.match(output, /- Codex \(codex\) \[active\]: missing \(missing codex\) via codex\.cmd/);
  assert.match(output, /- Claude Code \(claude\): missing \(missing claude\) via claude\.cmd/);
  assert.match(output, /- Augment CLI \(augment\): missing \(missing augment\) via augment\.cmd/);
  assert.match(output, /Next Step: unavailable/);
  assert.match(output, /Tracker does not currently expose a next recommended step\./);
  assert.match(output, /Mode: Plan Written - Needs Step/);
  assert.match(output, /AI advice: none cached yet \(run `\/advice` in studio to generate guidance\)\./);
  assert.match(
    output,
    /Next move: run `srgical studio <id>` \(or `srgical studio plan --plan <id>` \/ `srgical ssp <id>`\) to queue or refine the next execution-ready step\./
  );
});

test("doctor stays helpful before any plan has been created", async (t) => {
  const workspace = await createTempWorkspace("srgical-doctor-empty-");

  setAgentAdaptersForTesting([
    createFakeAdapter({
      id: "codex",
      label: "Codex",
      status: availableStatus("codex", "Codex", "0.113.0")
    }),
    createFakeAdapter({
      id: "claude",
      label: "Claude Code",
      status: unavailableStatus("claude", "Claude Code", "missing claude")
    })
  ]);
  t.after(resetAgentAdaptersForTesting);

  const output = await captureStdout(async () => {
    await runDoctorCommand(workspace);
  });

  assert.match(output, /Active plan: none/);
  assert.match(output, /Supported agents:/);
  assert.match(output, /- none: no planning packs detected yet/);
  assert.match(output, /Selected plan details: none selected yet\./);
  assert.match(
    output,
    /Next move: run `srgical init <id>` for a scaffold or `srgical studio <id>` to start planning\./
  );
});

test("doctor accepts a positional plan id", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "srgical-doctor-cli-"));
  await writePlanningPack(workspace, { planId: "proto" });

  const result = await runCli(["src/index.ts", "doctor", "proto"], workspace);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Active plan: proto/);
  assert.equal(await readActivePlanId(workspace), "proto");
});

function createFakeAdapter(options: {
  id: string;
  label: string;
  status: AgentStatus;
}): AgentAdapter {
  return {
    id: options.id,
    label: options.label,
    async detectStatus(): Promise<AgentStatus> {
      return options.status;
    },
    async requestPlannerReply(_workspaceRoot: string, _messages: ChatMessage[]): Promise<string> {
      return `${options.id}-planner`;
    },
    async requestPlanningAdvice(): Promise<string> {
      return JSON.stringify({
        version: 1,
        problemStatement: "fake",
        clarity: "mostly clear",
        stateAssessment: "fake",
        researchNeeded: [],
        advice: "fake",
        nextAction: "fake"
      });
    },
    async writePlanningPack(): Promise<string> {
      return `${options.id}-pack`;
    },
    async dicePlanningPack(): Promise<string> {
      return `${options.id}-dice`;
    },
    async runNextPrompt(): Promise<string> {
      return `${options.id}-run`;
    }
  };
}

function availableStatus(id: string, label: string, version: string): AgentStatus {
  return {
    id,
    label,
    available: true,
    command: `${id}.cmd`,
    version
  };
}

function unavailableStatus(id: string, label: string, error: string): AgentStatus {
  return {
    id,
    label,
    available: false,
    command: `${id}.cmd`,
    error
  };
}

function runCli(args: string[], cwd: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const resolvedArgs = args.map((arg, index) => (index === 0 ? path.resolve(process.cwd(), arg) : arg));
    const tsxLoaderUrl = pathToFileURL(path.resolve(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs")).href;
    const child = spawn(process.execPath, ["--import", tsxLoaderUrl, ...resolvedArgs], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SRGICAL_DISABLE_UPDATE_CHECK: "true"
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
