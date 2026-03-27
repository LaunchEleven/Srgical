#!/usr/bin/env node

import path from "node:path";
import {
  npmCommand,
  prepareStagedPackage,
  resolveReleaseState,
  root,
  runChecked,
  versionExists
} from "./release-shared.mjs";

const registry = process.env.GITHUB_PACKAGE_REGISTRY ?? "https://npm.pkg.github.com";
const packageName = process.env.GITHUB_PACKAGE_NAME ?? "@launcheleven/srgical";
const releaseState = await resolveReleaseState();

if (versionExists(packageName, releaseState.version, registry, process.env)) {
  process.stdout.write(`${packageName}@${releaseState.version} is already published on ${registry}. Skipping GitHub publish.\n`);
  process.exit(0);
}

const stagingDir = path.join(root, ".artifacts", "publish", "github-packages");
await prepareStagedPackage({
  stagingDir,
  packageName,
  version: releaseState.version,
  registry
});

runChecked(npmCommand, ["publish", "--registry", registry], {
  cwd: stagingDir,
  env: {
    ...process.env,
    npm_config_registry: registry
  }
});
