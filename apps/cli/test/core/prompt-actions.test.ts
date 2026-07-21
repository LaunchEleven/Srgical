import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillInvocationPrompt, buildWorktreePromptActions, resolveSkillInvocation } from "@srgical/studio-core";
import type { SkillRecord } from "@srgical/studio-shared";

const clean = {
  baseRef: "main",
  mergeBase: "abc123",
  aheadCount: 2,
  behindCount: 0,
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  conflictCount: 0
};

test("worktree prompt actions gate conflict mutation to isolated lanes", () => {
  const conflicted = { ...clean, conflictCount: 2 };
  const repositoryActions = buildWorktreePromptActions("current", conflicted, []);
  assert.equal(repositoryActions.find((item) => item.actionId === "builtin-inspect-conflicts")?.enabled, true);
  assert.equal(repositoryActions.find((item) => item.actionId === "builtin-resolve-conflicts")?.enabled, false);

  const worktreeActions = buildWorktreePromptActions("feature-a", conflicted, []);
  const resolve = worktreeActions.find((item) => item.actionId === "builtin-resolve-conflicts");
  assert.equal(resolve?.enabled, true);
  assert.equal(resolve?.permissionMode, "acceptEdits");
  assert.match(resolve?.prompt ?? "", /Do not commit/);
});

test("worktree prompt actions expose base updates and effective skill buttons", () => {
  const actions = buildWorktreePromptActions("feature-a", { ...clean, behindCount: 3 }, [{
    actionId: "review-api",
    label: "Review API",
    description: "Review the API contract.",
    prompt: "Check compatibility and fix clear issues.",
    skillId: "api-review",
    skillSource: "/skills/api-review/SKILL.md",
    available: true,
    blockedReason: null
  }]);
  assert.equal(actions.find((item) => item.actionId === "builtin-update-from-base")?.enabled, true);
  const custom = actions.find((item) => item.actionId === "skill-review-api");
  assert.equal(custom?.kind, "skill");
  assert.equal(custom?.skillId, "api-review");
  assert.equal(custom?.permissionMode, "acceptEdits");
});

test("skill buttons can edit a selected non-Git working directory", () => {
  const actions = buildWorktreePromptActions("current", clean, [{
    actionId: "tidy-notes",
    label: "Tidy notes",
    description: "Clean up the selected folder's notes.",
    prompt: "Organize the notes and fix formatting.",
    skillId: "notes",
    skillSource: "/skills/notes/SKILL.md",
    available: true,
    blockedReason: null
  }], false);

  assert.equal(actions.find((item) => item.actionId === "skill-tidy-notes")?.permissionMode, "acceptEdits");
  assert.equal(actions.find((item) => item.actionId === "builtin-integration-check")?.enabled, false);
});

test("slash skill invocations resolve effective skills and preserve the user task", () => {
  const skill = createSkill({ id: "api-review", name: "API Review", effective: true });
  const invocation = resolveSkillInvocation("/api-review check backwards compatibility", [skill]);

  assert.equal(invocation?.status, "ready");
  assert.equal(invocation?.skill, skill);
  assert.equal(invocation?.task, "check backwards compatibility");
  assert.match(buildSkillInvocationPrompt(skill, invocation!.task), /Read and follow its complete instructions/);
  assert.match(buildSkillInvocationPrompt(skill, invocation!.task), /check backwards compatibility/);
});

test("slash skill invocations report known but inactive skills", () => {
  const inactive = createSkill({ id: "release", name: "Release", effective: false });
  const invocation = resolveSkillInvocation("/RELEASE", [inactive]);

  assert.equal(invocation?.status, "unavailable");
  assert.match(invocation?.task ?? "", /Apply this skill/);
  assert.equal(resolveSkillInvocation("/unknown do something", [inactive]), null);
});

function createSkill(overrides: Pick<SkillRecord, "id" | "name" | "effective">): SkillRecord {
  return {
    ...overrides,
    description: `${overrides.name} workflow`,
    scope: "project",
    source: `/skills/${overrides.id}`,
    rootPath: `/skills/${overrides.id}`,
    manifestPath: `/skills/${overrides.id}/SKILL.md`,
    supportingFiles: [],
    hash: "hash",
    trust: "trusted",
    enabled: true,
    shadowedBy: null,
    compatibleProviders: [],
    warnings: []
  };
}
