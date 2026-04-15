import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CompletionInstallTarget = {
  shell: "bash" | "powershell";
  profilePath: string;
  block: string;
};

export type CompletionInstallResult = {
  installed: string[];
  alreadyPresent: string[];
  failed: string[];
};

type CompletionInstallRuntime = {
  homedir?: string;
  platform?: NodeJS.Platform;
};

const COMPLETION_MARKER_START = "# >>> srgical completion >>>";
const COMPLETION_MARKER_END = "# <<< srgical completion <<<";

export async function installShellCompletionProfiles(
  runtime: CompletionInstallRuntime = {}
): Promise<CompletionInstallResult> {
  const targets = getCompletionInstallTargets(runtime);
  const result: CompletionInstallResult = {
    installed: [],
    alreadyPresent: [],
    failed: []
  };

  for (const target of targets) {
    try {
      const outcome = await ensureCompletionBlock(target.profilePath, target.block);

      if (outcome === "installed") {
        result.installed.push(target.profilePath);
      } else {
        result.alreadyPresent.push(target.profilePath);
      }
    } catch {
      result.failed.push(target.profilePath);
    }
  }

  return result;
}

export function getCompletionInstallTargets(runtime: CompletionInstallRuntime = {}): CompletionInstallTarget[] {
  const homedir = runtime.homedir ?? os.homedir();
  const platform = runtime.platform ?? process.platform;
  const targets: CompletionInstallTarget[] = [
    {
      shell: "bash",
      profilePath: path.join(homedir, ".bashrc"),
      block: renderBashProfileBlock()
    }
  ];

  if (platform === "win32") {
    targets.push(
      {
        shell: "powershell",
        profilePath: path.join(homedir, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
        block: renderPowerShellProfileBlock()
      },
      {
        shell: "powershell",
        profilePath: path.join(homedir, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
        block: renderPowerShellProfileBlock()
      }
    );
  } else {
    targets.push({
      shell: "powershell",
      profilePath: path.join(homedir, ".config", "powershell", "Microsoft.PowerShell_profile.ps1"),
      block: renderPowerShellProfileBlock()
    });
  }

  return targets;
}

export function renderCompletionInstallSummary(result: CompletionInstallResult): string | null {
  if (result.installed.length === 0 && result.alreadyPresent.length === 0 && result.failed.length === 0) {
    return null;
  }

  const installed = result.installed.length > 0 ? `${result.installed.length} installed` : null;
  const present = result.alreadyPresent.length > 0 ? `${result.alreadyPresent.length} already present` : null;
  const failed = result.failed.length > 0 ? `${result.failed.length} failed` : null;

  return ["Shell completion:", [installed, present, failed].filter(Boolean).join(", ")].join(" ");
}

async function ensureCompletionBlock(profilePath: string, block: string): Promise<"installed" | "already_present"> {
  let current = "";

  try {
    current = await readFile(profilePath, "utf8");
  } catch {
    current = "";
  }

  if (current.includes(COMPLETION_MARKER_START) || current.includes(block.trim())) {
    return "already_present";
  }

  await mkdir(path.dirname(profilePath), { recursive: true });
  const nextContent =
    current.length > 0
      ? `${current.replace(/\s*$/, "")}\n\n${block}\n`
      : `${block}\n`;

  await writeFile(profilePath, nextContent, "utf8");
  return "installed";
}

function renderBashProfileBlock(): string {
  return [COMPLETION_MARKER_START, 'eval "$(srgical completion bash)"', COMPLETION_MARKER_END].join("\n");
}

function renderPowerShellProfileBlock(): string {
  return [COMPLETION_MARKER_START, "Invoke-Expression (& srgical completion powershell)", COMPLETION_MARKER_END].join("\n");
}
