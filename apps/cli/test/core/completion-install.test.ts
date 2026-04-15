import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getCompletionInstallTargets,
  installShellCompletionProfiles,
  renderCompletionInstallSummary
} from "../../src/core/completion-install";
import { createTempWorkspace } from "../helpers/workspace";

test("get-completion-install-targets includes bash plus Windows PowerShell profiles on win32", () => {
  const targets = getCompletionInstallTargets({
    homedir: "C:\\Users\\TestUser",
    platform: "win32"
  });

  assert.deepEqual(
    targets.map((target) => target.profilePath),
    [
      path.join("C:\\Users\\TestUser", ".bashrc"),
      path.join("C:\\Users\\TestUser", "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
      path.join("C:\\Users\\TestUser", "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1")
    ]
  );
});

test("install-shell-completion-profiles writes managed blocks once and preserves existing content", async () => {
  const home = await createTempWorkspace("srgical-completion-install-");
  const bashProfile = path.join(home, ".bashrc");

  await writeFile(bashProfile, "export PATH=\"$HOME/bin:$PATH\"\n", "utf8");

  const firstInstall = await installShellCompletionProfiles({
    homedir: home,
    platform: "linux"
  });

  assert.deepEqual(firstInstall.installed.sort(), [
    path.join(home, ".bashrc"),
    path.join(home, ".config", "powershell", "Microsoft.PowerShell_profile.ps1")
  ]);
  assert.deepEqual(firstInstall.alreadyPresent, []);
  assert.deepEqual(firstInstall.failed, []);

  const bashContent = await readFile(bashProfile, "utf8");
  const powerShellContent = await readFile(
    path.join(home, ".config", "powershell", "Microsoft.PowerShell_profile.ps1"),
    "utf8"
  );

  assert.match(bashContent, /^export PATH="\$HOME\/bin:\$PATH"/);
  assert.match(bashContent, /# >>> srgical completion >>>/);
  assert.match(bashContent, /eval "\$\(srgical completion bash\)"/);
  assert.match(powerShellContent, /Invoke-Expression \(& srgical completion powershell\)/);

  const secondInstall = await installShellCompletionProfiles({
    homedir: home,
    platform: "linux"
  });

  assert.deepEqual(secondInstall.installed, []);
  assert.deepEqual(secondInstall.alreadyPresent.sort(), [
    path.join(home, ".bashrc"),
    path.join(home, ".config", "powershell", "Microsoft.PowerShell_profile.ps1")
  ]);
  assert.deepEqual(secondInstall.failed, []);
});

test("render-completion-install-summary reports install outcomes compactly", () => {
  assert.equal(
    renderCompletionInstallSummary({
      installed: ["a", "b"],
      alreadyPresent: ["c"],
      failed: ["d"]
    }),
    "Shell completion: 2 installed, 1 already present, 1 failed"
  );
});
