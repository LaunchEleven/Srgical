# srgical

`srgical` is a local-first CLI for planning work with an AI, turning that plan into a visible pack inside your repo, and then executing the next step cleanly.

It is built around a simple loop:

1. `prepare` the plan
2. approve it
3. `operate` the next step
4. repeat

## Install From npm

Requirements:

- Node.js 20 or newer
- A Claude Console API key or supported cloud provider for the native Claude experience; a working `codex`, `claude`, or `auggie` CLI remains available as a compatibility fallback

```bash
npm install -g @launch11/srgical
```

After install:

```bash
srgical about
```

## Quick Start

Create or reopen a named plan:

```bash
srgical prepare release-readiness
```

Add `--web` for the conversation-first local Studio:

```bash
srgical prepare release-readiness --web
```

The Studio keeps worktrees, conversations, provider activity, approvals, questions, plan state, and skills in one window.

## Native Claude provider

The native provider uses `@anthropic-ai/claude-agent-sdk` and activates when one of these supported authentication paths is configured:

- `ANTHROPIC_API_KEY`
- `CLAUDE_CODE_USE_BEDROCK=1`
- `CLAUDE_CODE_USE_VERTEX=1`
- `CLAUDE_CODE_USE_FOUNDRY=1`

Srgical deliberately does not reuse Claude subscription OAuth or browser credentials. If supported native authentication is unavailable, Studio explains why and uses the selected local CLI adapter.

Native sessions support partial streaming, durable resume/fork, tool progress, tasks, permission prompts, questions, interrupt, usage/rate-limit events, and file checkpoints.

## Sessions

A session is the durable unit of conversation; a worktree is a workspace the session may use for a period of time. They intentionally are not one-to-one. Studio provides a repository-wide session library with search, recency groups, pinned and archived views, message previews, fork ancestry, and current or retired workspace context. A session can be reopened in its live worktree or forked into a fresh worktree when its previous workspace has retired.

Use **Finish Work** on a lane for post-operation cleanup. Studio assesses active operations, dirty/conflicted files, divergence, locks, and primary-checkout safety before acting. Finishing archives the lane's sessions and records their terminal commit and workspace summary. Worktree removal remains separately gated and requires the lane ID as typed confirmation; the branch, transcripts, plan artifacts, and binding history are retained.

## Worktrees and skills

Each lane maps one worktree and branch to one plan, a set of durable sessions, and an effective skill set. Studio reports dirty/conflict counts, ahead/behind state, stale or prunable worktrees, locks, and a recommended safe next action.

The global skills directory is created automatically at `~/.srgical/skills`. Studio also discovers:

- `.srgical/skills`
- `.claude/skills` and `~/.claude/skills`
- `.codex/skills` and `~/.codex/skills`
- `.agents/skills`
- `skills`
- additional directories configured in the Skills inspector

Skills are hashed with their supporting files and tracked by source, scope, trust, compatibility, precedence, and conflicts. They can be enabled, disabled, trusted, reviewed, or blocked per repository.

That command creates the plan pack under `.srgical/plans/release-readiness/` if it does not exist, then opens the full-screen prepare studio.

Inside `prepare`:

- Type normal text to talk to the planner
- Press `F2` to gather more context
- Use `:import <path>` to read a specific document and sync it into `context.md`
- Use `:context` to refresh `context.md` from the current transcript and gathered evidence
- Press `F3` to build the draft
- Press `F4` to slice the plan into steps
- Press `F6` to approve the current draft
- Type `:help` to see the command list

Check the current state at any time:

```bash
srgical status release-readiness
```

When the plan is approved, switch to execution:

```bash
srgical operate release-readiness
```

Useful operate variants:

```bash
srgical operate release-readiness --dry-run
srgical operate release-readiness --auto --max-steps 5
srgical operate release-readiness --checkpoint
```

## Main Commands

```bash
srgical prepare <id>
srgical operate <id>
srgical status [id]
srgical about
srgical changelog
srgical completion bash
srgical completion powershell
```

## What Gets Written

Visible plan artifacts remain in `.srgical/` inside your repo. Durable sessions and skill preferences live under `~/.srgical/`; the worktree registry lives in shared Git metadata so branch changes cannot rewrite management state.

Inside prepare, `context.md` is treated as a living document. Gather/import actions can refresh it directly before you build the full draft.

## Notes

- Legacy commands such as `doctor`, `init`, `studio`, and `run-next` now exist only to point you to the rebooted workflow.
- If you want a fuller walkthrough of the prepare experience, see [docs/studio-plan-tutorial.md](docs/studio-plan-tutorial.md).

## Development

```bash
npm install
npm run build
npm test
npm run dev -- prepare release-readiness
```
