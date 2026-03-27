# Testing Strategy

## Purpose

This plan turns the current srgical CLI into a continuously verifiable tool instead of a repo that only relies on
manual smoke checks. It is deliberately staged so we cover the highest-risk flows first and use the work to shake out
real bugs.

## Current Risk Map

### Tier 1: Command safety

- `doctor` must report truthful repo and agent state.
- `init` must create a usable planning pack and fail safely on accidental overwrite.
- `run-next` must never execute stale or unsafe work when the tracker has no queued step.
- `studio` slash-command flows must keep explicit user control over writes and execution.

### Tier 2: Pack integrity

- workspace path helpers must resolve `.srgical/` files consistently.
- template generation must always produce a complete four-file planning pack.
- planning-pack state parsing must keep tracker truth aligned with command output.
- execution state and durable logs must round-trip without corrupting summaries.

### Tier 3: Adapter and Agent behavior

- primary-agent status detection must degrade cleanly when any supported adapter is unavailable.
- planner, pack-writing, and execution adapters must preserve today's multi-agent behavior across Codex, Claude Code,
  and Augment CLI.
- Windows command resolution and shell-shim launching must stay covered because that path has already broken once.

### Tier 4: Release confidence

- `release:pack` must build, validate, and emit the npm tarball plus manifests.
- package contents must stay intentional.
- release workflow configuration must remain aligned with the local release script.

## Coverage Plan

### Phase A: Fast local tests

- built-in Node test runner through `tsx`
- temp-workspace integration tests for command behavior
- pure-module tests for parser and formatter logic

This is the right default layer for the current codebase because most logic is filesystem- and text-driven, not UI DOM
driven.

### Phase B: Studio behavior tests

- isolate slash-command handlers into smaller helpers
- test `/write`, `/preview`, `/run`, and `/help` behavior without booting a full terminal
- add keyboard behavior tests for transcript scrolling once more of the TUI logic is extracted from Blessed setup

### Phase C: Agent and platform regression tests

- stub the primary-agent adapter to verify planner, pack-write, and execution command paths
- add Windows-focused regression cases for command resolution and `.cmd` launch behavior
- add negative tests for missing agent, malformed tracker files, and partial planning-pack state

### Phase D: Release verification

- assert that `npm run release:pack` creates the tarball and release manifests
- inspect packed file lists and fail if unintended files leak into the npm artifact
- optionally run these as a slower integration suite in CI only

## Executable Baseline Added Now

- `test/core/planning-pack-state.test.ts`
- `test/core/execution-state.test.ts`
- `test/commands/doctor.test.ts`
- `test/commands/run-next.test.ts`

These cover the current highest-signal logic: tracker parsing, execution-state durability, truthful `doctor` output,
and safe `run-next` behavior.

## Bugs Surfaced During This Planning Pass

- `run-next` was still willing to execute even when the tracker exposed no next recommended step. That left room for a
  stale `.srgical/04-next-agent-prompt.md` to run after the tracker was effectively complete.
- The same safety issue existed in the studio `/run` path.

Both execution paths are now guarded by the same queued-step safety rule.

## Commands

```bash
npm test
npm run test:coverage
```

## Near-Term Next Test Steps

- add `init` command tests, especially overwrite protection
- extract and test studio slash-command helpers
- add agent-adapter stubs for unavailable-agent and successful-execution cases
- add release-pack integration assertions for tarball contents and manifest hashes
