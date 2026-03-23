#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const releaseDir = path.join(root, ".artifacts", "release");
const packageJsonPath = path.join(root, "package.json");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

runChecked(npmCommand, ["run", "build"], { cwd: root });
runChecked(process.execPath, ["dist/index.js", "doctor"], { cwd: root });

const packResult = runChecked(npmCommand, ["pack", "--pack-destination", releaseDir], { cwd: root });
const tarballName = packResult.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1);

if (!tarballName) {
  throw new Error("npm pack did not report the generated tarball name.");
}

const tarballPath = path.join(releaseDir, tarballName);
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const tarballBuffer = await readFile(tarballPath);
const tarballStats = await stat(tarballPath);
const sha256 = createHash("sha256").update(tarballBuffer).digest("hex");
const generatedAt = new Date().toISOString();

const manifest = {
  generatedAt,
  package: {
    name: packageJson.name,
    version: packageJson.version
  },
  validation: [
    "npm run build",
    "node dist/index.js doctor",
    "npm pack --pack-destination .artifacts/release"
  ],
  artifacts: [
    {
      channel: "npm",
      kind: "package-tarball",
      file: tarballName,
      relativePath: toPosixPath(path.relative(root, tarballPath)),
      bytes: tarballStats.size,
      sha256,
      installExample: `npm install -g ./${toPosixPath(path.relative(root, tarballPath))}`
    }
  ],
  plannedChannels: [
    {
      channel: "standalone-binaries",
      status: "defined",
      plan:
        "Build Windows, macOS, and Linux binaries from tagged releases after the current Node-based workflow is stable. Publish those binaries on GitHub Releases alongside the npm tarball."
    },
    {
      channel: "wrapper-package-managers",
      status: "defined",
      plan:
        "Homebrew, Chocolatey, and similar wrappers should install versioned GitHub Release artifacts instead of rebuilding the CLI from source in each ecosystem."
    }
  ]
};

await writeFile(path.join(releaseDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(path.join(releaseDir, "release-manifest.md"), buildMarkdownManifest(manifest), "utf8");

process.stdout.write(`Release bundle ready in ${toPosixPath(path.relative(root, releaseDir))}\n`);
process.stdout.write(`- Tarball: ${tarballName}\n`);
process.stdout.write(`- SHA256: ${sha256}\n`);

function runChecked(command, args, options) {
  const isShellShim = command.toLowerCase().endsWith(".cmd") || command.toLowerCase().endsWith(".bat");
  const result = isShellShim
    ? spawnSync([quoteForShell(command), ...args.map(quoteForShell)].join(" "), {
        ...options,
        encoding: "utf8",
        shell: true,
        stdio: ["inherit", "pipe", "pipe"]
      })
    : spawnSync(command, args, {
        ...options,
        encoding: "utf8",
        stdio: ["inherit", "pipe", "pipe"]
      });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function buildMarkdownManifest(manifest) {
  const artifact = manifest.artifacts[0];

  return [
    "# Release Manifest",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Package: ${manifest.package.name}@${manifest.package.version}`,
    "",
    "## Validated Commands",
    "",
    ...manifest.validation.map((command) => `- \`${command}\``),
    "",
    "## Produced Artifact",
    "",
    `- File: \`${artifact.file}\``,
    `- Relative path: \`${artifact.relativePath}\``,
    `- Size: ${artifact.bytes} bytes`,
    `- SHA256: \`${artifact.sha256}\``,
    `- Install test: \`${artifact.installExample}\``,
    "",
    "## Defined Future Channels",
    "",
    ...manifest.plannedChannels.map((channel) => `- ${channel.channel}: ${channel.plan}`),
    ""
  ].join("\n");
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function quoteForShell(value) {
  if (/^[A-Za-z0-9_:\\/.=-]+$/.test(value)) {
    return value;
  }

  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
