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

const packageName = process.env.NPM_PUBLIC_PACKAGE_NAME ?? "@launch11/srgical";
const registry = process.env.NPM_PUBLIC_REGISTRY ?? "https://registry.npmjs.org/";
const access = process.env.NPM_PUBLIC_ACCESS ?? "public";
const releaseState = await resolveReleaseState();

if (versionExists(packageName, releaseState.version, registry, process.env)) {
  process.stdout.write(`${packageName}@${releaseState.version} is already published on ${registry}. Skipping npm public publish.\n`);
  process.exit(0);
}

const stagingDir = path.join(root, ".artifacts", "publish", "npm-public");
await prepareStagedPackage({
  stagingDir,
  packageName,
  version: releaseState.version,
  registry,
  access
});

runChecked(npmCommand, ["publish", "--registry", registry, "--access", access], {
  cwd: stagingDir,
  env: {
    ...process.env,
    npm_config_registry: registry
  }
});
