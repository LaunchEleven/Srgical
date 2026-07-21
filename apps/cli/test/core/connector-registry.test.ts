import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  getConnectorRegistryPath,
  importMcpJson,
  installConnectorPreset,
  loadConnectorRegistry,
  resolveConnectorRegistry,
  setConnectorEnabled,
  upsertConnector
} from "@srgical/connector-registry";

test("connector registry installs verified presets outside the repository", async () => {
  const home = await createTempHome();
  await installConnectorPreset("repo-1", "linear", home);

  const snapshot = await loadConnectorRegistry("repo-1", { homeDir: home, env: {} });
  assert.equal(snapshot.connectors.length, 1);
  assert.equal(snapshot.connectors[0].definition.url, "https://mcp.linear.app/mcp");
  assert.equal(snapshot.connectors[0].status, "ready");
  assert.equal(snapshot.configPath, getConnectorRegistryPath("repo-1", home));
  assert.equal(snapshot.catalog.find((preset) => preset.presetId === "linear")?.authorization.method, "hosted-oauth");

  const stored = JSON.parse(await readFile(snapshot.configPath, "utf8")) as { version: number };
  assert.equal(stored.version, 1);
});

test("connector catalog includes the hosted Notion OAuth service", async () => {
  const home = await createTempHome();
  await installConnectorPreset("repo-notion", "notion", home);

  const snapshot = await loadConnectorRegistry("repo-notion", { homeDir: home, env: {} });
  const notion = snapshot.connectors.find((connector) => connector.presetId === "notion");
  assert.equal(notion?.definition.transport, "http");
  assert.equal(notion?.definition.url, "https://mcp.notion.com/mcp");
  assert.equal(notion?.status, "ready");
});

test("connector catalog includes GitHub's official hosted MCP server", async () => {
  const home = await createTempHome();
  await installConnectorPreset("repo-github", "github", home);

  const missing = await loadConnectorRegistry("repo-github", { homeDir: home, env: {} });
  const github = missing.connectors.find((connector) => connector.presetId === "github");
  assert.equal(github?.definition.transport, "http");
  assert.equal(github?.definition.url, "https://api.githubcopilot.com/mcp/");
  assert.deepEqual(github?.missingEnvironmentVariables, ["GITHUB_PERSONAL_ACCESS_TOKEN"]);
  const githubPreset = missing.catalog.find((preset) => preset.presetId === "github");
  assert.equal(githubPreset?.authorization.method, "personal-token");
  assert.deepEqual(githubPreset?.authorization.environmentVariables, ["GITHUB_PERSONAL_ACCESS_TOKEN"]);
  assert.equal(githubPreset?.setupUrl, "https://github.com/settings/personal-access-tokens/new");

  const ready = await loadConnectorRegistry("repo-github", { homeDir: home, env: { GITHUB_PERSONAL_ACCESS_TOKEN: "test-token" } });
  const resolved = resolveConnectorRegistry(ready, { GITHUB_PERSONAL_ACCESS_TOKEN: "test-token" });
  assert.equal(resolved.servers.github.headers?.Authorization, "Bearer test-token");
});

test("connector registry resolves environment references without persisting resolved secrets", async () => {
  const home = await createTempHome();
  await upsertConnector("repo-2", {
    label: "Private API",
    definition: {
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer ${PRIVATE_MCP_TOKEN}" }
    }
  }, home);

  const missing = await loadConnectorRegistry("repo-2", { homeDir: home, env: {} });
  assert.deepEqual(missing.connectors[0].missingEnvironmentVariables, ["PRIVATE_MCP_TOKEN"]);
  assert.equal(missing.connectors[0].status, "missing-environment");

  const ready = await loadConnectorRegistry("repo-2", { homeDir: home, env: { PRIVATE_MCP_TOKEN: "secret-value" } });
  const resolved = resolveConnectorRegistry(ready, { PRIVATE_MCP_TOKEN: "secret-value" });
  assert.equal(resolved.servers["private-api"].headers?.Authorization, "Bearer secret-value");
  assert.doesNotMatch(await readFile(ready.configPath, "utf8"), /secret-value/);
});

test("connector registry imports standard stdio and remote mcpServers JSON", async () => {
  const home = await createTempHome();
  const imported = await importMcpJson("repo-3", JSON.stringify({
    mcpServers: {
      local: { command: "npx", args: ["-y", "@example/mcp"] },
      remote: { type: "sse", url: "https://mcp.example.com/sse" }
    }
  }), home);
  assert.deepEqual(imported.sort(), ["local", "remote"]);

  const snapshot = await loadConnectorRegistry("repo-3", { homeDir: home });
  assert.equal(snapshot.connectors.find((item) => item.connectorId === "local")?.definition.transport, "stdio");
  assert.equal(snapshot.connectors.find((item) => item.connectorId === "remote")?.definition.transport, "sse");

  await setConnectorEnabled("repo-3", "local", false, home);
  const disabled = await loadConnectorRegistry("repo-3", { homeDir: home });
  assert.equal(disabled.connectors.find((item) => item.connectorId === "local")?.status, "disabled");
});

test("connector registry rejects insecure non-local remote URLs", async () => {
  const home = await createTempHome();
  await assert.rejects(() => upsertConnector("repo-4", {
    label: "Unsafe",
    definition: { transport: "http", url: "http://example.com/mcp" }
  }, home), /must use HTTPS/);
});

test("connector registry reports malformed persisted JSON instead of overwriting it", async () => {
  const home = await createTempHome();
  const configPath = getConnectorRegistryPath("repo-5", home);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, "{not-json", "utf8");
  await assert.rejects(() => loadConnectorRegistry("repo-5", { homeDir: home }), /Could not read connector configuration/);
  assert.equal(await readFile(configPath, "utf8"), "{not-json");
});

async function createTempHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "srgical-connectors-"));
  after(async () => rm(home, { recursive: true, force: true }));
  return home;
}
