import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addSkillDirectory,
  discoverSkills,
  parseSkillFrontmatter,
  removeSkillPromptAction,
  setSkillOverride,
  upsertSkillPromptAction
} from "@srgical/skill-registry";

test("skill registry creates the global directory and resolves project precedence", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "srgical-skills-"));
  const homeDir = path.join(root, "home");
  const workspace = path.join(root, "repo");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeSkill(path.join(homeDir, ".srgical", "skills", "review"), "Review", "Global review rules");
  await writeSkill(path.join(workspace, ".srgical", "skills", "review"), "Review", "Project review rules");
  await writeSkill(path.join(workspace, ".claude", "skills", "release"), "Release", "Claude release flow");

  const snapshot = await discoverSkills(workspace, { homeDir });

  assert.equal(snapshot.globalSkillsDirectory, path.join(homeDir, ".srgical", "skills"));
  assert.equal(snapshot.skills.length, 3);
  assert.equal(snapshot.skills.find((skill) => skill.id === "review" && skill.effective)?.scope, "project");
  assert.equal(snapshot.conflicts[0]?.skillId, "review");
  assert.deepEqual(snapshot.skills.find((skill) => skill.id === "release")?.compatibleProviders, ["anthropic-agent-sdk"]);
  assert.equal(snapshot.effectiveSkillHashes.length, 2);
});

test("skill parser reports malformed manifests without executing content", () => {
  const parsed = parseSkillFrontmatter("---\nname: Safe Review\ndescription: 'Review changes'\nproviders: [codex, anthropic-agent-sdk]\n---\n# Instructions");
  assert.equal(parsed.attributes.name, "Safe Review");
  assert.equal(parsed.attributes.description, "Review changes");
  assert.equal(parsed.body.trim(), "# Instructions");
  assert.deepEqual(parseSkillFrontmatter("# no frontmatter").warnings, ["SKILL.md has no YAML frontmatter."]);
});

test("skill registry persists directory, enablement, and trust management per repository", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "srgical-skills-config-"));
  const homeDir = path.join(root, "home");
  const workspace = path.join(root, "repo");
  const custom = path.join(root, "shared-skills");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeSkill(path.join(custom, "deploy"), "Deploy", "Deploy safely");
  await addSkillDirectory("repo-1", custom, homeDir);
  const initial = await discoverSkills(workspace, { homeDir, repoId: "repo-1" });
  const deploy = initial.skills.find((skill) => skill.id === "deploy");
  assert.equal(deploy?.effective, true);
  assert.deepEqual(initial.configuredDirectories, [custom]);

  await setSkillOverride("repo-1", deploy!.source, { enabled: false, trust: "blocked" }, homeDir);
  const updated = await discoverSkills(workspace, { homeDir, repoId: "repo-1" });
  assert.equal(updated.skills.find((skill) => skill.id === "deploy")?.effective, false);
  assert.equal(updated.skills.find((skill) => skill.id === "deploy")?.trust, "blocked");
});

test("skill prompt buttons resolve only against effective skills", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "srgical-skill-actions-"));
  const homeDir = path.join(root, "home");
  const workspace = path.join(root, "repo");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeSkill(path.join(workspace, ".srgical", "skills", "conflict-review"), "Conflict Review", "Review conflict intent");

  const actionId = await upsertSkillPromptAction("repo-actions", {
    label: "Review conflict intent",
    prompt: "Compare both sides and explain the intended behavior.",
    skillId: "conflict-review"
  }, homeDir);
  assert.equal(actionId, "review-conflict-intent");

  const ready = await discoverSkills(workspace, { homeDir, repoId: "repo-actions" });
  assert.equal(ready.promptActions[0]?.available, true);
  assert.match(ready.promptActions[0]?.skillSource ?? "", /SKILL\.md$/);

  const skill = ready.skills.find((item) => item.id === "conflict-review" && item.effective)!;
  await setSkillOverride("repo-actions", skill.source, { enabled: false }, homeDir);
  const blocked = await discoverSkills(workspace, { homeDir, repoId: "repo-actions" });
  assert.equal(blocked.promptActions[0]?.available, false);
  assert.match(blocked.promptActions[0]?.blockedReason ?? "", /Enable a non-blocked/);

  await removeSkillPromptAction("repo-actions", actionId, homeDir);
  const removed = await discoverSkills(workspace, { homeDir, repoId: "repo-actions" });
  assert.deepEqual(removed.promptActions, []);
});

async function writeSkill(directory: string, name: string, description: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`, "utf8");
  await writeFile(path.join(directory, "reference.md"), `${name} support`, "utf8");
}
