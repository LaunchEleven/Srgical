import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import {
  loadStudioUiConfig,
  MAX_WHEEL_SENSITIVITY,
  MIN_WHEEL_SENSITIVITY,
  sanitizeWheelSensitivity,
  saveStudioUiConfig,
  wheelSensitivityToScrollStep
} from "../../src/core/studio-ui-config";
import { ensurePlanningDir, getPlanningPackPaths } from "../../src/core/workspace";
import { createTempWorkspace } from "../helpers/workspace";

test("studio-ui-config defaults to a smooth wheel sensitivity", async () => {
  const workspace = await createTempWorkspace("srgical-ui-config-defaults-");
  const config = await loadStudioUiConfig(workspace, { planId: "demo" });

  assert.equal(config.wheelSensitivity, 2);
});

test("save-studio-ui-config clamps wheel sensitivity into the supported range", async () => {
  const workspace = await createTempWorkspace("srgical-ui-config-save-");

  const low = await saveStudioUiConfig(workspace, { wheelSensitivity: -999 }, { planId: "demo" });
  assert.equal(low.wheelSensitivity, MIN_WHEEL_SENSITIVITY);

  const high = await saveStudioUiConfig(workspace, { wheelSensitivity: 999 }, { planId: "demo" });
  assert.equal(high.wheelSensitivity, MAX_WHEEL_SENSITIVITY);
});

test("load-studio-ui-config sanitizes malformed on-disk values safely", async () => {
  const workspace = await createTempWorkspace("srgical-ui-config-parse-");
  await ensurePlanningDir(workspace, { planId: "demo" });
  const paths = getPlanningPackPaths(workspace, { planId: "demo" });

  await writeFile(
    paths.studioUiConfig,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-04-14T00:00:00.000Z",
      wheelSensitivity: "banana"
    }),
    "utf8"
  );

  const config = await loadStudioUiConfig(workspace, { planId: "demo" });
  assert.equal(config.wheelSensitivity, 2);
});

test("wheel sensitivity maps to bounded scroll steps", () => {
  assert.equal(sanitizeWheelSensitivity(1), 1);
  assert.equal(sanitizeWheelSensitivity(10), 10);
  assert.equal(sanitizeWheelSensitivity(7.6), 8);
  assert.equal(wheelSensitivityToScrollStep(1), 1);
  assert.equal(wheelSensitivityToScrollStep(2), 1);
  assert.equal(wheelSensitivityToScrollStep(3), 2);
  assert.equal(wheelSensitivityToScrollStep(10), 5);
});
