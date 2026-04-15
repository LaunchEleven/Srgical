import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  compareReleaseVersions,
  renderUpgradeNotice,
  resolveUpgradeNotice,
  shouldCheckForUpgradeNotice
} from "../../src/core/update-notice";
import { createTempWorkspace } from "../helpers/workspace";

test("should-check-for-upgrade-notice only enables interactive human sessions", () => {
  assert.equal(shouldCheckForUpgradeNotice({}, true), true);
  assert.equal(shouldCheckForUpgradeNotice({ CI: "true" }, true), false);
  assert.equal(shouldCheckForUpgradeNotice({ SRGICAL_DISABLE_UPDATE_CHECK: "true" }, true), false);
  assert.equal(shouldCheckForUpgradeNotice({ npm_config_loglevel: "silent" }, true), false);
  assert.equal(shouldCheckForUpgradeNotice({}, false), false);
});

test("compare-release-versions sorts semver numerically and keeps stable releases above prereleases", () => {
  assert.equal(compareReleaseVersions("1.2.0", "1.2.0"), 0);
  assert.equal(compareReleaseVersions("1.2.1", "1.2.0") > 0, true);
  assert.equal(compareReleaseVersions("1.10.0", "1.9.9") > 0, true);
  assert.equal(compareReleaseVersions("1.2.0", "1.2.0-beta.1") > 0, true);
  assert.equal(compareReleaseVersions("1.2.0-beta.2", "1.2.0-beta.10") < 0, true);
});

test("render-upgrade-notice points users at the public npm upgrade command", () => {
  const notice = renderUpgradeNotice("0.1.0", "0.2.0");

  assert.match(notice, /Upgrade available/);
  assert.match(notice, /installed 0\.1\.0/);
  assert.match(notice, /latest 0\.2\.0/);
  assert.match(notice, /npm i -g @launch11\/srgical/);
});

test("resolve-upgrade-notice fetches the latest version, caches it, and shows a notice once", async () => {
  const home = await createTempWorkspace("srgical-update-home-");
  const writes: string[] = [];

  const firstNotice = await resolveUpgradeNotice("0.1.0", {
    env: {},
    isTTY: true,
    platform: "linux",
    homedir: home,
    now: () => new Date("2026-04-03T00:00:00.000Z"),
    fetchLatestVersion: async () => "0.2.0",
    onCacheWrite: (filePath) => {
      writes.push(filePath);
    }
  });

  assert.match(firstNotice ?? "", /npm i -g @launch11\/srgical/);
  assert.equal(writes.length, 1);

  const secondNotice = await resolveUpgradeNotice("0.1.0", {
    env: {},
    isTTY: true,
    platform: "linux",
    homedir: home,
    now: () => new Date("2026-04-03T01:00:00.000Z"),
    fetchLatestVersion: async () => {
      throw new Error("should not refetch while cache is fresh");
    }
  });

  assert.equal(secondNotice, null);
});

test("resolve-upgrade-notice refreshes stale cache and stays quiet when already current", async () => {
  const home = await createTempWorkspace("srgical-update-home-current-");
  const stateDir = path.join(home, ".local", "state", "srgical");
  const stateFile = path.join(stateDir, "update-check.json");

  await mkdir(stateDir, { recursive: true });
  await writeFile(
    stateFile,
    JSON.stringify(
      {
        version: 1,
        installedVersion: "0.1.0",
        latestVersion: "0.2.0",
        checkedAt: "2026-03-30T00:00:00.000Z",
        notifiedInstalledVersion: "0.1.0",
        notifiedLatestVersion: "0.2.0"
      },
      null,
      2
    ),
    "utf8"
  );

  const notice = await resolveUpgradeNotice("0.2.0", {
    env: {},
    isTTY: true,
    platform: "linux",
    homedir: home,
    now: () => new Date("2026-04-03T00:00:00.000Z"),
    fetchLatestVersion: async () => "0.2.0"
  });

  assert.equal(notice, null);

  const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
    installedVersion: string;
    latestVersion: string | null;
    notifiedInstalledVersion?: string | null;
  };

  assert.equal(saved.installedVersion, "0.2.0");
  assert.equal(saved.latestVersion, "0.2.0");
  assert.equal(saved.notifiedInstalledVersion ?? null, null);
});
