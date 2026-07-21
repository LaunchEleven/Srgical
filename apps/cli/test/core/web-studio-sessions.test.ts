import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { AgentSessionStore, deriveRepositoryId } from "@srgical/agent-runtime";
import { createWorktreeLane, setWorktreeLaneDeleteLock } from "../../src/core/worktree-lanes";
import { createConversationPlanId, createWebStudioHost, deriveConversationPlanLabel, resolveStudioPort } from "../../src/ui/web-studio";
import { createTempWorkspace } from "../helpers/workspace";

const execFileAsync = promisify(execFile);

test("web host finishes a lane by archiving sessions before safely removing its worktree", async (t) => {
  const repo = await initGitRepo();
  const sessionHome = await mkdtemp(path.join(os.tmpdir(), "srgical-finish-sessions-"));
  t.after(() => rm(sessionHome, { recursive: true, force: true }));
  const store = new AgentSessionStore({ homeDir: sessionHome });
  const created = await createWorktreeLane(repo, { planId: "finish-flow", mode: "operate" });
  await execGit(["add", "."], created.workspace);
  await execGit(["commit", "-m", "prepare finish flow"], created.workspace);
  await setWorktreeLaneDeleteLock(repo, created.lane.laneId, false);
  const repoId = deriveRepositoryId(repo);
  const session = await store.create({
    providerId: "legacy-cli:claude",
    repoId,
    laneId: created.lane.laneId,
    workspace: created.workspace,
    planId: "finish-flow",
    title: "Finish flow",
    model: null,
    permissionMode: "acceptEdits",
    capabilities: ["sessions"],
    effectiveSkillHashes: [],
    branchName: created.lane.branchName,
    startingCommit: created.lane.mergeBase
  });
  const host = await createWebStudioHost({ workspace: repo, agentSessionStore: store, repositoryHistoryHomeDir: sessionHome, openBrowser: false });
  t.after(() => host.close());

  const assessment = await host.assessFinish(created.lane.laneId);
  assert.equal(assessment.canArchive, true);
  assert.equal(assessment.canRemoveWorktree, true);
  assert.equal(assessment.sessionCount, 1);

  const result = await host.finishLane({
    laneId: created.lane.laneId,
    archiveSessions: true,
    removeWorktree: true,
    confirmation: created.lane.laneId
  });
  assert.equal(result.worktreeRemoved, true);
  assert.equal(result.branchRetained, true);
  assert.deepEqual(result.archivedSessionIds, [session.sessionId]);
  const archived = await store.load(repoId, session.sessionId);
  assert.equal(archived?.lifecycle, "archived");
  assert.equal(archived?.workspaceBindings[0]?.retirementReason, "worktree-removed");
  const events = await store.readEvents(repoId, session.sessionId);
  const retirement = events.find((event) => event.kind === "workspace.retired");
  assert.equal(retirement?.payload.reason, "worktree-removed");
  assert.equal(retirement?.payload.endingCommit, archived?.workspaceBindings[0]?.endingCommit);
  assert.equal((await host.getRepoSnapshot()).lanes.some((lane) => lane.laneId === created.lane.laneId && !lane.removed), false);
});

test("web host starts a repository conversation and promotes it to a worktree", async (t) => {
  const repo = await initGitRepo();
  const otherRepo = await initGitRepo();
  const sessionHome = await mkdtemp(path.join(os.tmpdir(), "srgical-conversation-sessions-"));
  t.after(() => rm(sessionHome, { recursive: true, force: true }));
  const store = new AgentSessionStore({ homeDir: sessionHome });
  const host = await createWebStudioHost({ workspace: repo, agentSessionStore: store, repositoryHistoryHomeDir: sessionHome, openBrowser: false });
  t.after(() => host.close());

  const opened = await host.startConversation({
    message: "Understand the authentication flow before we change anything",
    isolation: "repository"
  });
  const studio = host.getStudioSession(opened.studioToken);
  assert.ok(studio);
  assert.equal(opened.laneId, "current");
  assert.equal(studio.controller.getSnapshot().laneId, "current");
  assert.equal(studio.controller.getSnapshot().agentSession.title, "New conversation");
  assert.equal((await host.getRepoSnapshot()).lanes.filter((lane) => lane.source === "managed").length, 0);

  const promoted = await host.forkSessionIntoWorktree(studio.controller.getSnapshot().agentSession.sessionId);
  assert.notEqual(promoted.laneId, "current");
  const promotedStudio = host.getStudioSession(promoted.studioToken);
  assert.equal(promotedStudio?.controller.getSnapshot().agentSession.parentSessionId, studio.controller.getSnapshot().agentSession.sessionId);
  assert.equal(promotedStudio?.controller.getSnapshot().agentSession.title, studio.controller.getSnapshot().agentSession.title);
  await access(path.join(promotedStudio!.workspace, ".srgical", "plans", studio.planId, "context.md"));

  await setWorktreeLaneDeleteLock(repo, promoted.laneId, false);
  await host.removeLane(promoted.laneId);

  const switched = await host.selectRepository(otherRepo);
  assert.equal(path.resolve(switched.repoRoot), path.resolve(otherRepo));
  assert.deepEqual(switched.repositories.map((entry) => path.resolve(entry.path)), [path.resolve(otherRepo), path.resolve(repo)]);
  assert.equal(switched.repositories.filter((entry) => entry.selected).length, 1);
});

test("internal plan ids are derived without turning the first prompt into a chat title", () => {
  assert.equal(deriveConversationPlanLabel("  Investigate the flaky test\nThen propose a fix  "), "Investigate the flaky test");
  assert.match(createConversationPlanId("Investigate the flaky test"), /^investigate-the-flaky-test-[a-f0-9]{6}$/);
});

test("browser Studio uses a stable installable-app origin unless its port is overridden", () => {
  assert.equal(resolveStudioPort(undefined, undefined), 43111);
  assert.equal(resolveStudioPort(undefined, "44000"), 44000);
  assert.equal(resolveStudioPort(0, "44000"), 0);
  assert.throws(() => resolveStudioPort(undefined, "not-a-port"), /integer between 0 and 65535/);
});

async function initGitRepo(): Promise<string> {
  const repo = await createTempWorkspace("srgical-web-finish-");
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "package.json"), "{\"name\":\"demo\"}\n", "utf8");
  await writeFile(path.join(repo, "src", "index.ts"), "export const demo = true;\n", "utf8");
  await execGit(["init", "-b", "main"], repo);
  await execGit(["config", "user.name", "Srgical Test"], repo);
  await execGit(["config", "user.email", "test@example.com"], repo);
  await execGit(["add", "."], repo);
  await execGit(["commit", "-m", "initial"], repo);
  return repo;
}

async function execGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}
