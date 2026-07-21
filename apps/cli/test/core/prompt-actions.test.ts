import assert from "node:assert/strict";
import test from "node:test";
import { buildWorktreePromptActions } from "@srgical/studio-core";

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
