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
- At least one local agent CLI installed and working on your machine: `codex`, `claude`, or `auggie`

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

`srgical` keeps its working state in `.srgical/` inside your repo so the plan, progress, and execution handoff stay visible to both humans and agents.

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
