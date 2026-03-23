import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  detectClaude,
  requestPlannerReply,
  resetClaudeRuntimeForTesting,
  runNextPrompt,
  setClaudeRuntimeForTesting,
  writePlanningPack
} from "../../src/core/claude";
import { readText, writeText } from "../../src/core/workspace";
import { createTempWorkspace, writePlanningPack as writeInitialPlanningPack } from "../helpers/workspace";
import { withMockedPlatform } from "../helpers/platform";

test("detect-claude reports the resolved command version", async (t) => {
  setClaudeRuntimeForTesting({
    command: "claude.cmd",
    spawnAndCapture: async (command, args) => {
      assert.equal(command, "claude.cmd");
      assert.deepEqual(args, ["--version"]);
      return {
        stdout: "claude-code 1.2.3\n",
        stderr: ""
      };
    }
  });
  t.after(resetClaudeRuntimeForTesting);

  const status = await detectClaude();

  assert.equal(status.available, true);
  assert.equal(status.command, "claude.cmd");
  assert.equal(status.version, "claude-code 1.2.3");
});

test("detect-claude resolves a sibling Windows shim when where.exe returns an extensionless path", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "srgical-claude-detect-"));
  const extensionless = path.join(tempDir, "claude");
  const siblingShim = `${extensionless}.cmd`;

  await writeFile(siblingShim, "@echo off\r\n", "utf8");
  t.after(resetClaudeRuntimeForTesting);

  await withMockedPlatform("win32", async () => {
    setClaudeRuntimeForTesting({
      command: null,
      spawnAndCapture: async (command, args) => {
        if (command === "where.exe") {
          assert.deepEqual(args, ["claude"]);
          return {
            stdout: `${extensionless}\r\n`,
            stderr: ""
          };
        }

        assert.equal(command, siblingShim);
        assert.deepEqual(args, ["--version"]);
        return {
          stdout: "claude-code 1.2.3\n",
          stderr: ""
        };
      }
    });

    const status = await detectClaude();

    assert.equal(status.available, true);
    assert.equal(status.command, siblingShim);
    assert.equal(status.version, "claude-code 1.2.3");
  });
});

test("detect-claude turns the raw Windows where.exe miss into a cleaner install hint", async (t) => {
  t.after(resetClaudeRuntimeForTesting);

  await withMockedPlatform("win32", async () => {
    setClaudeRuntimeForTesting({
      command: null,
      spawnAndCapture: async () => {
        throw new Error("INFO: Could not find files for the given pattern(s).");
      }
    });

    const status = await detectClaude();

    assert.equal(status.available, false);
    assert.equal(status.command, "claude.exe");
    assert.equal(status.error, "install Claude Code CLI to enable");
  });
});

test("request-planner-reply uses Claude print mode with plan permissions", async (t) => {
  const workspace = await createTempWorkspace("srgical-claude-plan-");
  const messages = [
    { role: "user" as const, content: "Help me map the next step." },
    { role: "assistant" as const, content: "Share the current repo truth." }
  ];

  setClaudeRuntimeForTesting({
    command: "claude.cmd",
    spawnAndCapture: async (command, args) => {
      assert.equal(command, "claude.cmd");
      assert.ok(args.includes("-p"));
      assert.ok(args.includes("--output-format"));
      assert.ok(args.includes("text"));
      assert.equal(args[argValueIndex(args, "--permission-mode")], "plan");
      assert.ok(args.includes("--append-system-prompt-file"));
      assert.ok(args.includes("--no-session-persistence"));
      assert.equal(args[argValueIndex(args, "--max-turns")], "4");

      const prompt = await readFile(args[argValueIndex(args, "--append-system-prompt-file")], "utf8");
      assert.match(prompt, /You are the planning partner inside srgical/);
      assert.match(prompt, /Help me map the next step\./);
      assert.match(prompt, /Share the current repo truth\./);

      return {
        stdout: "Planned response from Claude.\n",
        stderr: ""
      };
    }
  });
  t.after(resetClaudeRuntimeForTesting);

  const reply = await requestPlannerReply(workspace, messages);

  assert.equal(reply, "Planned response from Claude.");
});

test("write-planning-pack uses Claude acceptEdits settings and preserves planning-epoch summaries", async (t) => {
  const workspace = await createTempWorkspace("srgical-claude-pack-");
  const paths = await writeInitialPlanningPack(workspace);
  let invocationCount = 0;

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

  setClaudeRuntimeForTesting({
    command: "claude.cmd",
    spawnAndCapture: async (_command, args) => {
      invocationCount += 1;

      if (args.length === 1 && args[0] === "--version") {
        return {
          stdout: "claude-code 1.2.3\n",
          stderr: ""
        };
      }

      assert.equal(args[argValueIndex(args, "--permission-mode")], "acceptEdits");

      const prompt = await readFile(args[argValueIndex(args, "--append-system-prompt-file")], "utf8");
      assert.match(prompt, /You are writing a planning pack for the current repository\./);

      const settings = JSON.parse(await readFile(args[argValueIndex(args, "--settings")], "utf8")) as {
        permissions?: { allow?: string[] };
      };
      assert.deepEqual(settings.permissions?.allow, ["Bash", "Read", "Edit", "Write"]);

      return {
        stdout: "Claude pack write complete.\n",
        stderr: ""
      };
    }
  });
  t.after(resetClaudeRuntimeForTesting);

  const result = await writePlanningPack(workspace, [{ role: "user", content: "Refresh the pack." }]);

  assert.equal(invocationCount, 2);
  assert.match(result, /Started a new planning epoch by archiving the previous active pack/);
  assert.match(result, /Claude pack write complete\./);
});

test("write-planning-pack falls back locally with Claude-specific messaging when Claude is unavailable", async (t) => {
  const workspace = await createTempWorkspace("srgical-claude-fallback-");
  const paths = await writeInitialPlanningPack(workspace);

  setClaudeRuntimeForTesting({
    command: "claude.cmd",
    spawnAndCapture: async () => {
      throw new Error("ENOENT");
    }
  });
  t.after(resetClaudeRuntimeForTesting);

  const result = await writePlanningPack(workspace, [{ role: "user", content: "Refresh the pack locally." }]);
  const context = await readText(paths.context);

  assert.match(result, /Local fallback pack refresh completed because Claude Code was unavailable\./);
  assert.match(context, /Triggered an explicit local planning-pack refresh because Claude Code was unavailable\./);
  assert.match(context, /without invoking Claude Code\./);
});

test("run-next-prompt uses Claude acceptEdits mode and returns trimmed output", async (t) => {
  const workspace = await createTempWorkspace("srgical-claude-run-");

  setClaudeRuntimeForTesting({
    command: "claude.cmd",
    spawnAndCapture: async (_command, args) => {
      assert.equal(args[argValueIndex(args, "--permission-mode")], "acceptEdits");

      const prompt = await readFile(args[argValueIndex(args, "--append-system-prompt-file")], "utf8");
      assert.equal(prompt, "Execute the next tracker step carefully.");

      return {
        stdout: "Execution summary from Claude.\n",
        stderr: ""
      };
    }
  });
  t.after(resetClaudeRuntimeForTesting);

  const result = await runNextPrompt(workspace, "Execute the next tracker step carefully.");

  assert.equal(result, "Execution summary from Claude.");
});

function argValueIndex(args: string[], flag: string): number {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `Missing CLI flag ${flag}`);
  assert.ok(index + 1 < args.length, `Missing CLI value for ${flag}`);
  return index + 1;
}
