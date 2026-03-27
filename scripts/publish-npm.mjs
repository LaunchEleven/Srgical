#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(root, "package.json");
const releaseDir = path.join(root, ".artifacts", "release");
const stagingDir = path.join(root, ".artifacts", "publish", "npm-public");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const dryRun = process.argv.includes("--dry-run");
const packageName = process.env.NPM_PUBLIC_PACKAGE_NAME ?? "@launch11/srgical";
const registry = process.env.NPM_PUBLIC_REGISTRY ?? "https://registry.npmjs.org/";
const access = process.env.NPM_PUBLIC_ACCESS ?? "public";

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const version = packageJson.version;

if (versionExists(packageName, version, registry)) {
  process.stdout.write(`${packageName}@${version} is already published on ${registry}. Skipping npm public publish.\n`);
  process.exit(0);
}

await rm(stagingDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });
await mkdir(releaseDir, { recursive: true });

for (const relativePath of packageJson.files ?? []) {
  await copyFromRoot(relativePath);
}

for (const requiredPath of ["README.md", "LICENSE"]) {
  if (!(packageJson.files ?? []).includes(requiredPath)) {
    await copyFromRoot(requiredPath);
  }
}

const npmPackageJson = {
  ...packageJson,
  name: packageName,
  scripts: omitLifecycleScripts(packageJson.scripts),
  publishConfig: {
    access,
    registry
  }
};

await writeFile(path.join(stagingDir, "package.json"), `${JSON.stringify(npmPackageJson, null, 2)}\n`, "utf8");

const packResult = runChecked(npmCommand, ["pack", "--pack-destination", releaseDir], { cwd: stagingDir });
const tarballName = packResult.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1);

if (!tarballName) {
  throw new Error("npm pack did not report the generated npmjs tarball name.");
}

const tarballPath = path.join(releaseDir, tarballName);

if (dryRun) {
  process.stdout.write(`npm public publish dry run prepared ${toPosixPath(path.relative(root, tarballPath))}\n`);
  process.stdout.write(`- Package: ${packageName}\n`);
  process.stdout.write(`- Registry: ${registry}\n`);
  process.stdout.write(`- Access: ${access}\n`);
  process.exit(0);
}

runChecked(
  npmCommand,
  ["publish", tarballPath, "--registry", registry, "--access", access],
  {
    cwd: root,
    env: {
      ...process.env,
      npm_config_registry: registry
    }
  }
);

async function copyFromRoot(relativePath) {
  const sourcePath = path.join(root, relativePath);
  const destinationPath = path.join(stagingDir, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true });
}

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

function versionExists(name, version, registry) {
  const result = spawnSync(
    npmCommand,
    ["view", `${name}@${version}`, "version", "--registry", registry],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  if (result.status !== 0) {
    return false;
  }

  return (result.stdout ?? "").trim() === version;
}

function omitLifecycleScripts(scripts = {}) {
  const nextScripts = { ...scripts };

  delete nextScripts.prepack;
  delete nextScripts.postpack;
  delete nextScripts.prepare;
  delete nextScripts.prepublish;
  delete nextScripts.prepublishOnly;

  return nextScripts;
}

function quoteForShell(value) {
  if (/^[A-Za-z0-9_:\\/.=@-]+$/.test(value)) {
    return value;
  }

  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}
