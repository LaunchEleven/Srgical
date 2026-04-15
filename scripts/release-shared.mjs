import { spawnSync } from "node:child_process";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(scriptDir, "..");
export const cliRoot = path.join(root, "apps", "cli");
export const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export async function readBasePackageJson() {
  return JSON.parse(await readFile(path.join(cliRoot, "package.json"), "utf8"));
}

export async function resolveReleaseState() {
  const packageJson = await readBasePackageJson();
  const baseVersion = parseSemver(packageJson.version);
  const tagPattern = `v${baseVersion.major}.${baseVersion.minor}.*`;
  const headVersions = listReleaseVersions(["tag", "--points-at", "HEAD", "--list", tagPattern]);

  if (headVersions.length > 0) {
    const current = headVersions.sort(compareSemverDesc)[0];
    return {
      alreadyTagged: true,
      version: formatSemver(current),
      tag: `v${formatSemver(current)}`,
      baseVersion: packageJson.version
    };
  }

  const releasedVersions = listReleaseVersions(["tag", "--list", tagPattern]);
  const latestPatch = releasedVersions.reduce((max, version) => Math.max(max, version.patch), baseVersion.patch);
  const nextVersion = {
    major: baseVersion.major,
    minor: baseVersion.minor,
    patch: latestPatch + 1
  };

  return {
    alreadyTagged: false,
    version: formatSemver(nextVersion),
    tag: `v${formatSemver(nextVersion)}`,
    baseVersion: packageJson.version
  };
}

export async function prepareStagedPackage({
  stagingDir,
  packageName,
  version,
  registry,
  access
}) {
  const packageJson = await readBasePackageJson();

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  for (const relativePath of packageJson.files ?? []) {
    await copyFromRoot(relativePath, stagingDir);
  }

  for (const requiredPath of ["README.md", "LICENSE"]) {
    if (!(packageJson.files ?? []).includes(requiredPath)) {
      await copyFromRoot(requiredPath, stagingDir);
    }
  }

  await bundleWorkspaceDependencies(packageJson, stagingDir);

  const stagedPackageJson = {
    ...packageJson,
    name: packageName,
    version,
    scripts: omitLifecycleScripts(packageJson.scripts),
    publishConfig: {
      ...(packageJson.publishConfig ?? {}),
      ...(access ? { access } : {}),
      registry
    }
  };

  await writeFile(path.join(stagingDir, "package.json"), `${JSON.stringify(stagedPackageJson, null, 2)}\n`, "utf8");

  return {
    packageJson: stagedPackageJson,
    stagingDir
  };
}

export async function packStagedPackage(stagingDir, releaseDir) {
  await mkdir(releaseDir, { recursive: true });
  const packResult = runChecked(npmCommand, ["pack", "--pack-destination", releaseDir], { cwd: stagingDir });
  const tarballName = packResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!tarballName) {
    throw new Error(`npm pack did not report the generated tarball name for ${stagingDir}.`);
  }

  return {
    tarballName,
    tarballPath: path.join(releaseDir, tarballName)
  };
}

export function versionExists(name, version, registry, env = process.env) {
  const result = spawnSync(npmCommand, ["view", `${name}@${version}`, "version", "--registry", registry], {
    cwd: cliRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env
  });

  if (result.status !== 0) {
    return false;
  }

  return (result.stdout ?? "").trim() === version;
}

export function runChecked(command, args, options) {
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

export function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function listReleaseVersions(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }

  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((tag) => parseSemver(tag.startsWith("v") ? tag.slice(1) : tag))
    .filter(Boolean);
}

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);

  if (!match) {
    throw new Error(`Expected a simple semver version, received "${value}".`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function formatSemver(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function compareSemverDesc(left, right) {
  if (left.major !== right.major) {
    return right.major - left.major;
  }

  if (left.minor !== right.minor) {
    return right.minor - left.minor;
  }

  return right.patch - left.patch;
}

async function copyFromRoot(relativePath, stagingDir) {
  const sourcePath = path.join(cliRoot, relativePath);
  const destinationPath = path.join(stagingDir, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true });
}

async function bundleWorkspaceDependencies(packageJson, stagingDir) {
  const dependencyNames = Object.keys(packageJson.dependencies ?? {}).filter((name) => name.startsWith("@srgical/"));

  for (const dependencyName of dependencyNames) {
    const workspaceDir = resolveWorkspacePackageDir(dependencyName);
    const dependencyPackageJson = JSON.parse(await readFile(path.join(workspaceDir, "package.json"), "utf8"));

    runChecked(npmCommand, ["run", "build", "-w", dependencyName], { cwd: root });

    const dependencyStagingDir = path.join(stagingDir, "node_modules", ...dependencyName.split("/"));
    await rm(dependencyStagingDir, { recursive: true, force: true });
    await mkdir(dependencyStagingDir, { recursive: true });

    if (await pathExists(path.join(workspaceDir, "dist"))) {
      await cp(path.join(workspaceDir, "dist"), path.join(dependencyStagingDir, "dist"), { recursive: true });
    }

    for (const maybeFile of ["README.md", "CHANGELOG.md", "LICENSE"]) {
      if (await pathExists(path.join(workspaceDir, maybeFile))) {
        await cp(path.join(workspaceDir, maybeFile), path.join(dependencyStagingDir, maybeFile), { recursive: true });
      }
    }

    const stagedDependencyPackageJson = {
      ...dependencyPackageJson,
      private: false,
      scripts: omitLifecycleScripts(dependencyPackageJson.scripts)
    };

    await writeFile(
      path.join(dependencyStagingDir, "package.json"),
      `${JSON.stringify(stagedDependencyPackageJson, null, 2)}\n`,
      "utf8"
    );
  }
}

function resolveWorkspacePackageDir(packageName) {
  const unscopedName = packageName.split("/").at(-1);
  if (!unscopedName) {
    throw new Error(`Could not resolve workspace package name for ${packageName}.`);
  }

  return path.join(root, "packages", unscopedName);
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function omitLifecycleScripts(scripts = {}) {
  const nextScripts = { ...scripts };

  delete nextScripts.prepack;
  delete nextScripts.postpack;
  delete nextScripts.prepare;
  delete nextScripts.prepublish;
  delete nextScripts.prepublishOnly;
  delete nextScripts.release;
  delete nextScripts["release:pack"];
  delete nextScripts["publish:github"];
  delete nextScripts["publish:npm"];
  delete nextScripts["release:version"];
  delete nextScripts["release:state"];
  delete nextScripts.changeset;
  delete nextScripts["version-packages"];

  return nextScripts;
}

function quoteForShell(value) {
  if (/^[A-Za-z0-9_:\\/.=@-]+$/.test(value)) {
    return value;
  }

  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
