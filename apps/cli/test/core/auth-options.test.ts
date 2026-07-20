import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildAnthropicProviderEnvironment,
  buildCodexProviderEnvironment,
  createAgentProviderForAuthOption,
  detectAgentAuthOptions,
  selectAgentAuthOption
} from "@srgical/agent-runtime";

test("authentication options independently report live subscription and API routes", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "srgical-auth-options-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const authFilePath = path.join(directory, "auth.json");
  await writeFile(authFilePath, JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "present" } }), "utf8");

  const statuses = await detectAgentAuthOptions(null, {
    codexAuthFilePath: authFilePath,
    env: {
      OPENAI_API_KEY: "openai-key",
      ANTHROPIC_API_KEY: "anthropic-key",
      CLAUDE_CODE_USE_BEDROCK: "1"
    }
  });

  assert.equal(statuses.find((item) => item.id === "codex-chatgpt")?.authenticated, true);
  assert.equal(statuses.find((item) => item.id === "codex-api-key")?.authenticated, true);
  assert.equal(statuses.find((item) => item.id === "claude-api-key")?.authenticated, true);
  assert.equal(statuses.find((item) => item.id === "claude-bedrock")?.authenticated, true);
  assert.equal(selectAgentAuthOption(statuses, null)?.id, "codex-chatgpt");
});

test("provider factories preserve the selected billing path in their provider ids", () => {
  assert.equal(createAgentProviderForAuthOption("codex-chatgpt").id, "codex-sdk:chatgpt");
  assert.equal(createAgentProviderForAuthOption("codex-api-key").id, "codex-sdk:api-key");
  assert.equal(createAgentProviderForAuthOption("claude-api-key").id, "anthropic-agent-sdk:api-key");
});

test("provider environments remove competing credentials", () => {
  const source = {
    PATH: "test-path",
    OPENAI_API_KEY: "openai-key",
    CODEX_API_KEY: "codex-key",
    ANTHROPIC_API_KEY: "anthropic-key",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1"
  };

  const subscription = buildCodexProviderEnvironment(source, "chatgpt");
  assert.equal(subscription.OPENAI_API_KEY, undefined);
  assert.equal(subscription.CODEX_API_KEY, undefined);

  const codexApi = buildCodexProviderEnvironment(source, "api-key");
  assert.equal(codexApi.CODEX_API_KEY, "codex-key");
  assert.equal(codexApi.OPENAI_API_KEY, undefined);

  const claudeApi = buildAnthropicProviderEnvironment(source, "api-key");
  assert.equal(claudeApi.ANTHROPIC_API_KEY, "anthropic-key");
  assert.equal(claudeApi.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(claudeApi.CLAUDE_CODE_USE_VERTEX, undefined);

  const bedrock = buildAnthropicProviderEnvironment(source, "bedrock");
  assert.equal(bedrock.ANTHROPIC_API_KEY, undefined);
  assert.equal(bedrock.CLAUDE_CODE_USE_BEDROCK, "1");
});
