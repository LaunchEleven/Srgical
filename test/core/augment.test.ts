import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  detectAugment,
  requestPlannerReply,
  resetAugmentRuntimeForTesting,
  runNextPrompt,
  setAugmentRuntimeForTesting,
  writePlanningPack
} from "../../src/core/augment";
import { readText, writeText } from "../../src/core/workspace";
import { createTempWorkspace, writePlanningPack as writeInitialPlanningPack } from "../helpers/workspace";
import { withMockedPlatform } from "../helpers/platform";

test("detect-augment reports the resolved command version", async (t) => {
  setAugmentRuntimeForTesting({
    command: "auggie.cmd",
    spawnAndCapture: async (command, args) => {
      assert.equal(command, "auggie.cmd");
      assert.deepEqual(args, ["--version"]);
      return {
        stdout: "auggie 1.2.3\n",
        stderr: ""
      };
    }
  });
  t.after(resetAugmentRuntimeForTesting);

  const status = await detectAugment();

  assert.equal(status.available, true);
  assert.equal(status.command, "auggie.cmd");
  assert.equal(status.version, "auggie 1.2.3");
});

test("detect-augment resolves a sibling Windows shim when where.exe returns an extensionless path", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "srgical-augment-detect-"));
  const extensionless = path.join(tempDir, "auggie");
  const siblingShim = `${extensionless}.cmd`;

  await writeFile(siblingShim, "@echo off\r\n", "utf8");
  t.after(resetAugmentRuntimeForTesting);

  await withMockedPlatform("win32", async () => {
    setAugmentRuntimeForTesting({
      command: null,
      spawnAndCapture: async (command, args) => {
        if (command === "where.exe") {
          assert.deepEqual(args, ["auggie"]);
          return {
            stdout: `${extensionless}\r\n`,
            stderr: ""
          };
        }

        assert.equal(command, siblingShim);
        assert.deepEqual(args, ["--version"]);
        return {
          stdout: "auggie 1.2.3\n",
          stderr: ""
        };
      }
    });

    const status = await detectAugment();

    assert.equal(status.available, true);
    assert.equal(status.command, siblingShim);
    assert.equal(status.version, "auggie 1.2.3");
  });
});

test("detect-augment turns the raw Windows where.exe miss into a cleaner install hint", async (t) => {
  t.after(resetAugmentRuntimeForTesting);

  await withMockedPlatform("win32", async () => {
    setAugmentRuntimeForTesting({
      command: null,
      spawnAndCapture: async () => {
        throw new Error("INFO: Could not find files for the given pattern(s).");
      }
    });

    const status = await detectAugment();

    assert.equal(status.available, false);
    assert.equal(status.command, "auggie.exe");
    assert.equal(status.error, "install Augment CLI to enable");
  });
});

test("request-planner-reply uses Augment print mode with ask permissions", async (t) => {
  const workspace = await createTempWorkspace("srgical-augment-plan-");
  const messages = [
    { role: "user" as const, content: "Help me map the next step." },
    { role: "assistant" as const, content: "Share the current repo truth." }
  ];

  setAugmentRuntimeForTesting({
    command: "auggie.cmd",
    spawnAndCapture: async (command, args, cwd) => {
      assert.equal(command, "auggie.cmd");
      assert.equal(cwd, workspace);
      assert.ok(args.includes("--print"));
      assert.ok(args.includes("--quiet"));
      assert.ok(args.includes("--ask"));
      assert.equal(args[argValueIndex(args, "--workspace-root")], workspace);
      assert.ok(args.includes("--instruction-file"));
      assert.ok(args.includes("--rules"));
      assert.ok(args.includes("--allow-indexing"));
      assert.ok(args.includes("--wait-for-indexing"));
      assert.equal(args.includes("--dont-save-session"), false);
      assert.equal(args[argValueIndex(args, "--max-turns")], "4");

      const prompt = await readFile(args[argValueIndex(args, "--instruction-file")], "utf8");
      const rules = await readFile(args[argValueIndex(args, "--rules")], "utf8");
      assert.match(prompt, /You are the planning partner inside srgical/);
      assert.match(prompt, /Do not write files\./);
      assert.match(prompt, /Help me map the next step\./);
      assert.match(prompt, /Share the current repo truth\./);
      assert.match(rules, /planning and iteration machine/);
      assert.match(rules, /Prefer small validated steps over broad speculative rewrites\./);

      return {
        stdout: "Planned response from Augment.\n",
        stderr: ""
      };
    }
  });
  t.after(resetAugmentRuntimeForTesting);

  const reply = await requestPlannerReply(workspace, messages);

  assert.equal(reply, "Planned response from Augment.");
});

test("write-planning-pack uses Augment print mode and preserves planning-epoch summaries", async (t) => {
  const workspace = await createTempWorkspace("srgical-augment-pack-");
  const paths = await writeInitialPlanningPack(workspace);

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

  setAugmentRuntimeForTesting({
    command: "auggie.cmd",
    spawnAndCapture: async (_command, args, cwd) => {
      if (args.length === 1 && args[0] === "--version") {
        return {
          stdout: "auggie 1.2.3\n",
          stderr: ""
        };
      }

      assert.equal(cwd, workspace);

      assert.ok(args.includes("--print"));
      assert.ok(args.includes("--quiet"));
      assert.equal(args[argValueIndex(args, "--workspace-root")], workspace);
      assert.ok(args.includes("--rules"));
      assert.ok(args.includes("--allow-indexing"));
      assert.ok(args.includes("--wait-for-indexing"));
      assert.equal(args.includes("--dont-save-session"), false);
      assert.equal(args[argValueIndex(args, "--max-turns")], "24");
      assert.equal(args.includes("--ask"), false);

      const prompt = await readFile(args[argValueIndex(args, "--instruction-file")], "utf8");
      const rules = await readFile(args[argValueIndex(args, "--rules")], "utf8");
      assert.match(prompt, /You are writing a planning pack for the current repository\./);
      assert.match(rules, /Preserve a clear next-step handoff after each meaningful change\./);

      return {
        stdout: "Augment pack write complete.\n",
        stderr: ""
      };
    }
  });
  t.after(resetAugmentRuntimeForTesting);

  const result = await writePlanningPack(workspace, [{ role: "user", content: "Refresh the pack." }]);

  assert.match(result, /Started a new planning epoch by archiving the previous active pack/);
  assert.match(result, /Augment pack write complete\./);
});

test("write-planning-pack falls back locally with Augment-specific messaging when Augment is unavailable", async (t) => {
  const workspace = await createTempWorkspace("srgical-augment-fallback-");
  const paths = await writeInitialPlanningPack(workspace);

  setAugmentRuntimeForTesting({
    command: "auggie.cmd",
    spawnAndCapture: async () => {
      throw new Error("ENOENT");
    }
  });
  t.after(resetAugmentRuntimeForTesting);

  const result = await writePlanningPack(workspace, [{ role: "user", content: "Refresh the pack locally." }]);
  const context = await readText(paths.context);

  assert.match(result, /Local fallback pack refresh completed because Augment CLI was unavailable\./);
  assert.match(context, /Triggered an explicit local planning-pack refresh because Augment CLI was unavailable\./);
  assert.match(context, /without invoking Augment CLI\./);
});

test("run-next-prompt uses Augment print mode and returns trimmed output", async (t) => {
  const workspace = await createTempWorkspace("srgical-augment-run-");

  setAugmentRuntimeForTesting({
    command: "auggie.cmd",
    spawnAndCapture: async (_command, args, cwd) => {
      assert.equal(cwd, workspace);
      assert.ok(args.includes("--print"));
      assert.ok(args.includes("--quiet"));
      assert.equal(args[argValueIndex(args, "--workspace-root")], workspace);
      assert.ok(args.includes("--rules"));
      assert.equal(args.includes("--dont-save-session"), false);
      assert.equal(args[argValueIndex(args, "--max-turns")], "24");

      const prompt = await readFile(args[argValueIndex(args, "--instruction-file")], "utf8");
      const rules = await readFile(args[argValueIndex(args, "--rules")], "utf8");
      assert.equal(prompt, "Execute the next tracker step carefully.");
      assert.match(rules, /Keep outputs practical, explicit, and ready for the next iteration\./);

      return {
        stdout: "Execution summary from Augment.\n",
        stderr: ""
      };
    }
  });
  t.after(resetAugmentRuntimeForTesting);

  const result = await runNextPrompt(workspace, "Execute the next tracker step carefully.");

  assert.equal(result, "Execution summary from Augment.");
});

function argValueIndex(args: string[], flag: string): number {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `Missing CLI flag ${flag}`);
  assert.ok(index + 1 < args.length, `Missing CLI value for ${flag}`);
  return index + 1;
}
