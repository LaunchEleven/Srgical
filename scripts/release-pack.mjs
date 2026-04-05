#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  npmCommand,
  packStagedPackage,
  prepareStagedPackage,
  resolveReleaseState,
  root,
  runChecked,
  toPosixPath
} from "./release-shared.mjs";

const releaseDir = path.join(root, ".artifacts", "release");
const githubStagingDir = path.join(root, ".artifacts", "publish", "github-packages");
const npmStagingDir = path.join(root, ".artifacts", "publish", "npm-public");
const releaseState = await resolveReleaseState();
const releaseValidationPlanId = "release-pack";

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

runChecked(npmCommand, ["run", "build"], { cwd: root });
runChecked(process.execPath, ["dist/index.js", "status", "--plan", releaseValidationPlanId], { cwd: root });

await prepareStagedPackage({
  stagingDir: githubStagingDir,
  packageName: process.env.GITHUB_PACKAGE_NAME ?? "@launcheleven/srgical",
  version: releaseState.version,
  registry: process.env.GITHUB_PACKAGE_REGISTRY ?? "https://npm.pkg.github.com"
});

await prepareStagedPackage({
  stagingDir: npmStagingDir,
  packageName: process.env.NPM_PUBLIC_PACKAGE_NAME ?? "@launch11/srgical",
  version: releaseState.version,
  registry: process.env.NPM_PUBLIC_REGISTRY ?? "https://registry.npmjs.org/",
  access: process.env.NPM_PUBLIC_ACCESS ?? "public"
});

const githubArtifact = await buildArtifact({
  channel: "github-packages",
  packageName: process.env.GITHUB_PACKAGE_NAME ?? "@launcheleven/srgical",
  stagingDir: githubStagingDir,
  releaseDir
});

const npmArtifact = await buildArtifact({
  channel: "npm-public",
  packageName: process.env.NPM_PUBLIC_PACKAGE_NAME ?? "@launch11/srgical",
  stagingDir: npmStagingDir,
  releaseDir
});

const generatedAt = new Date().toISOString();
const manifest = {
  generatedAt,
  release: {
    baseVersion: releaseState.baseVersion,
    version: releaseState.version,
    tag: releaseState.tag
  },
  validation: [
    "npm run build",
    `node dist/index.js status --plan ${releaseValidationPlanId}`,
    "npm pack --pack-destination .artifacts/release (staged package copies)"
  ],
  artifacts: [githubArtifact, npmArtifact],
  plannedChannels: [
    {
      channel: "standalone-binaries",
      status: "defined",
      plan:
        "Build Windows, macOS, and Linux binaries from tagged releases after the current Node-based workflow is stable. Publish those binaries on GitHub Releases alongside the npm tarballs."
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
for (const artifact of manifest.artifacts) {
  process.stdout.write(`- ${artifact.channel}: ${artifact.file}\n`);
  process.stdout.write(`  SHA256: ${artifact.sha256}\n`);
}

async function buildArtifact({ channel, packageName, stagingDir, releaseDir }) {
  const { tarballName, tarballPath } = await packStagedPackage(stagingDir, releaseDir);
  const tarballBuffer = await readFile(tarballPath);
  const tarballStats = await stat(tarballPath);
  const sha256 = createHash("sha256").update(tarballBuffer).digest("hex");

  return {
    channel,
    kind: "package-tarball",
    packageName,
    version: releaseState.version,
    file: tarballName,
    relativePath: toPosixPath(path.relative(root, tarballPath)),
    bytes: tarballStats.size,
    sha256,
    installExample: `npm install -g ./${toPosixPath(path.relative(root, tarballPath))}`
  };
}

function buildMarkdownManifest(manifest) {
  return [
    "# Release Manifest",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Base version: ${manifest.release.baseVersion}`,
    `Computed release version: ${manifest.release.version}`,
    `Release tag: ${manifest.release.tag}`,
    "",
    "## Validated Commands",
    "",
    ...manifest.validation.map((command) => `- \`${command}\``),
    "",
    "## Produced Artifacts",
    "",
    ...manifest.artifacts.flatMap((artifact) => [
      `- Channel: ${artifact.channel}`,
      `- Package: \`${artifact.packageName}@${artifact.version}\``,
      `- File: \`${artifact.file}\``,
      `- Relative path: \`${artifact.relativePath}\``,
      `- Size: ${artifact.bytes} bytes`,
      `- SHA256: \`${artifact.sha256}\``,
      `- Install test: \`${artifact.installExample}\``,
      ""
    ]),
    "## Defined Future Channels",
    "",
    ...manifest.plannedChannels.map((channel) => `- ${channel.channel}: ${channel.plan}`),
    ""
  ].join("\n");
}
