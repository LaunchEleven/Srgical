# srgical Repo Plan

Updated: 2026-03-24

## Purpose

This file is the stable, high-level plan for the current repo direction. It keeps the real `srgical` product context
front and center and locks the current launch target around dual local-agent compatibility instead of a Codex-only
first pass.

## Repo Findings

- The repo already ships a working TypeScript/Node CLI with `doctor`, `init`, `studio`, and `run-next`.
- `.srgical/` is already the canonical repo-visible planning-pack location and contains a usable product plan,
  kickoff log, tracker, and next-agent prompt.
- The current codebase is the `srgical` product itself: a local-first orchestration CLI built with `commander`,
  `blessed`, and native child-process spawning for agent orchestration.
- The codebase now has a registry-backed adapter seam in `src/core/agent.ts` that can enumerate supported adapters and
  resolve the active agent dynamically.
- The studio, `doctor`, and `run-next` all flow through that seam, but session-scoped agent persistence and richer
  multi-agent UX are still not implemented yet.
- The studio already persists transcript history through `.srgical/studio-session.json`, but current session state does
  not yet include an active-agent choice.
- Live local validation on 2026-03-24 shows `codex` installed and runnable (`codex-cli 0.113.0`) while `claude` is
  not currently installed on this machine.
- Launch now needs compatibility with both Codex CLI and Claude Code CLI, with the UI detecting installed tools and
  letting the user choose which one to use for the current session.
- Claude detection groundwork now exists in the repo, but Claude planner, pack-writing, and execution flows are still
  intentionally deferred to `ADAPT003`.
- The `.srgical/` planning-pack workflow should stay agent-neutral even as adapter-specific runtime behavior expands.

## Mission

Make `srgical` launch-ready for both Codex CLI and Claude Code CLI while preserving the existing local-first,
terminal-first, markdown-visible planning and execution workflow.

## Primary Workflow To Optimize

1. Detect which supported local agent CLIs are installed.
2. Show truthful availability and let the user choose the active agent for the current session.
3. Plan inside the studio against the real repo using the selected agent.
4. Write or refresh the repo-visible `.srgical/` pack without changing its agent-neutral structure.
5. Execute the next eligible tracker block through the selected agent with explicit user control, validation, and
   durable logs.

## Locked Decisions

- `.srgical/` remains the canonical planning-pack format.
- TypeScript on Node remains the implementation stack for the current product phase.
- Launch scope must support both locally installed Codex CLI and Claude Code CLI paths.
- The studio and CLI must detect installed tools truthfully instead of assuming one globally available agent.
- The user can choose the active agent for the current session; if only one supported tool is installed, the product
  may auto-select it.
- The planning pack stays agent-neutral; adapter differences belong in runtime handling, selection UX, and execution
  prompts.
- AI actions remain explicit and user-triggered.
- The studio remains terminal-first and transcript-first.
- Codex behavior should not regress while Claude support is added.
- The interface should keep a bold, intentional visual direction rather than collapsing into a generic debug shell.

## Open Decision

- The final non-interactive write-permission profile for Claude Code CLI still needs validation. Default direction:
  prefer repo-scoped settings or allowlisted permissions first, and keep any broad permission-bypass mode behind an
  explicit opt-in rather than making it the default launch path.

## Product Principles For This Slice

- Keep the pack readable by humans first and executable by agents second.
- Make adapter selection obvious and truthful so users do not have to infer which tool is active.
- Preserve one shared execution workflow across agents instead of forking the product into agent-specific products.
- Prefer incremental changes that strengthen the existing seam instead of rewriting the app around a new abstraction.
- Record environment truth honestly, especially when one supported agent is installed and another is missing.

## Active Workstreams

- Multi-agent core:
  - expand the current adapter seam into a registry that can enumerate supported agents
  - resolve and persist the active agent for the current workspace session
- Claude launch compatibility:
  - implement a dedicated Claude Code CLI adapter for planner, pack-writing, and execution flows
  - preserve Codex as a stable path while Claude support is added incrementally
- Selection UX:
  - update the studio and `doctor` to show detected agents and the active session choice
  - support explicit per-run overrides where appropriate
- Validation and docs:
  - cover multi-agent detection, selection persistence, and Windows command resolution with tests
  - update user-facing docs so dual-agent launch behavior is clear and honest

## Target End State For The Current Slice

- `srgical` can work with either Codex CLI or Claude Code CLI at launch.
- The studio can detect installed supported tools and let the user choose one for the current session.
- `doctor` reports truthful multi-agent availability.
- `run-next` executes through the selected agent while preserving dry-run, logging, and recovery behavior.
- The `.srgical/` workflow stays stable, readable, and repo-visible.

## Non-Goals For This Slice

- Replacing the current planning-pack format.
- Forking the product into separate Codex-only and Claude-only workflows.
- Hiding Claude-specific permission caveats or pretending the two CLIs are interchangeable when they are not.
- Expanding into unrelated release channels or product areas before the dual-agent launch path is solid.

## Validation Strategy

- Re-check `.srgical/` state before each implementation block.
- Keep `doctor`, studio planning, pack writing, and `run-next` truthful about which agent is active and which agents
  are installed.
- Add test coverage for multi-agent detection, selection persistence, CLI overrides, and Windows command resolution.
- Validate both the happy path and the missing-agent path so launch UX stays calm and informative.

## Repo Files To Re-Open First

- `.srgical/02-agent-context-kickoff.md`
- `.srgical/03-detailed-implementation-plan.md`
- `.srgical/04-next-agent-prompt.md`
- `src/core/agent.ts`
- `src/core/codex.ts`
- `src/ui/studio.ts`
- `src/commands/doctor.ts`
- `src/commands/run-next.ts`
- `README.md`
- `docs/testing-strategy.md`
