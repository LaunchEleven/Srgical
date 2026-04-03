import test from "node:test";
import assert from "node:assert/strict";
import { renderPostinstallMessage, runPostinstall, shouldRenderPostinstallMessage } from "../../src/postinstall";

test("postinstall message is enabled for global interactive installs", () => {
  assert.equal(
    shouldRenderPostinstallMessage(
      {
        npm_config_global: "true",
        npm_config_loglevel: "notice"
      },
      true
    ),
    true
  );
});

test("postinstall message stays quiet for local, CI, or silent installs", () => {
  assert.equal(shouldRenderPostinstallMessage({ npm_config_global: "false" }, true), false);
  assert.equal(shouldRenderPostinstallMessage({ npm_config_global: "true", CI: "true" }, true), false);
  assert.equal(
    shouldRenderPostinstallMessage(
      {
        npm_config_global: "true",
        npm_config_loglevel: "silent"
      },
      true
    ),
    false
  );
  assert.equal(shouldRenderPostinstallMessage({ npm_config_global: "true" }, false), false);
});

test("render-postinstall-message points to the next useful commands", () => {
  const message = renderPostinstallMessage();

  assert.match(message, /srgical 0\.0\.0 is ready\./);
  assert.match(message, /Release notes: https:\/\/github\.com\/LaunchEleven\/Srgical\/releases\/tag\/v0\.0\.0/);
  assert.match(message, /Start here: srgical doctor/);
  assert.match(message, /More: srgical about/);
});

test("run-postinstall reports automatic shell completion setup", async () => {
  let output = "";

  await runPostinstall({
    env: {
      npm_config_global: "true"
    },
    isTTY: true,
    write: (value) => {
      output += value;
    },
    installProfiles: async () => ({
      installed: ["a", "b"],
      alreadyPresent: ["c"],
      failed: []
    })
  });

  assert.match(output, /Shell completion: 2 installed, 1 already present/);
});

test("run-postinstall can skip automatic profile edits via env flag", async () => {
  let output = "";
  let installCalls = 0;

  await runPostinstall({
    env: {
      npm_config_global: "true",
      SRGICAL_DISABLE_PROFILE_INSTALL: "true"
    },
    isTTY: true,
    write: (value) => {
      output += value;
    },
    installProfiles: async () => {
      installCalls += 1;
      return {
        installed: [],
        alreadyPresent: [],
        failed: []
      };
    }
  });

  assert.equal(installCalls, 0);
  assert.doesNotMatch(output, /Shell completion:/);
});
