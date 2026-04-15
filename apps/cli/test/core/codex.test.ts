import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectCodex, resetCodexRuntimeForTesting, setCodexRuntimeForTesting } from "../../src/core/codex";
import { withMockedPlatform } from "../helpers/platform";

test("detect-codex reports the resolved command version", async (t) => {
  setCodexRuntimeForTesting({
    command: "codex.cmd",
    spawnAndCapture: async (command, args) => {
      assert.equal(command, "codex.cmd");
      assert.deepEqual(args, ["--version"]);
      return {
        stdout: "codex-cli 0.113.0\n",
        stderr: ""
      };
    }
  });
  t.after(resetCodexRuntimeForTesting);

  const status = await detectCodex();

  assert.equal(status.available, true);
  assert.equal(status.command, "codex.cmd");
  assert.equal(status.version, "codex-cli 0.113.0");
});

test("detect-codex prefers the Windows shim returned by where.exe", async (t) => {
  t.after(resetCodexRuntimeForTesting);

  await withMockedPlatform("win32", async () => {
    const windowsShim = "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd";
    const windowsExe = "C:\\Program Files\\Codex\\codex.exe";

    setCodexRuntimeForTesting({
      command: null,
      spawnAndCapture: async (command, args) => {
        if (command === "where.exe") {
          assert.deepEqual(args, ["codex"]);
          return {
            stdout: `${windowsExe}\r\n${windowsShim}\r\n`,
            stderr: ""
          };
        }

        assert.equal(command, windowsShim);
        assert.deepEqual(args, ["--version"]);
        return {
          stdout: "codex-cli 0.113.0\n",
          stderr: ""
        };
      }
    });

    const status = await detectCodex();

    assert.equal(status.available, true);
    assert.equal(status.command, windowsShim);
    assert.equal(status.version, "codex-cli 0.113.0");
  });
});

test("detect-codex resolves a sibling Windows shim when where.exe returns an extensionless path", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "srgical-codex-detect-"));
  const extensionless = path.join(tempDir, "codex");
  const siblingShim = `${extensionless}.cmd`;

  await writeFile(siblingShim, "@echo off\r\n", "utf8");
  t.after(resetCodexRuntimeForTesting);

  await withMockedPlatform("win32", async () => {
    setCodexRuntimeForTesting({
      command: null,
      spawnAndCapture: async (command, args) => {
        if (command === "where.exe") {
          assert.deepEqual(args, ["codex"]);
          return {
            stdout: `${extensionless}\r\n`,
            stderr: ""
          };
        }

        assert.equal(command, siblingShim);
        assert.deepEqual(args, ["--version"]);
        return {
          stdout: "codex-cli 0.113.0\n",
          stderr: ""
        };
      }
    });

    const status = await detectCodex();

    assert.equal(status.available, true);
    assert.equal(status.command, siblingShim);
  });
});
