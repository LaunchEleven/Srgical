# Detailed Implementation Plan

Updated: 2026-03-24T22:51:16.9641094+11:00
Updated By: Codex

## Status Legend

- `pending`: not started
- `in_progress`: currently being executed
- `done`: completed and validated
- `blocked`: cannot proceed without resolving a blocker
- `skipped`: intentionally skipped by an explicit design decision

## Current Position

- Last Completed: `DOC002`
- Next Recommended: none queued
- Updated At: `2026-03-24T22:51:16.9641094+11:00`
- Updated By: `Codex`

## Step Rules

- Work 1 to 2 contiguous steps only when they stay in the same phase, touch the same subsystem, and still fit
  comfortably in context.
- Do not mark a step `done` without recording validation notes.
- Preserve the locked decisions from `01-product-plan.md` unless a tracker step explicitly requires otherwise.
- Update the current position and handoff log after each completed block.
- Stop immediately when a blocker changes scope materially.

## Bootstrap

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| BOOT-001 | done | - | Create the initial `.srgical/` planning-pack scaffold. | The pack exists and the repo has a starting handoff loop. | Completed during `srgical init`. |

## Planning

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| PLAN-001 | done | BOOT-001 | Convert the generic scaffold into a repo-specific product plan, kickoff log, tracker, and next-agent prompt. | The pack reflects the real project direction and is ready for execution. | Completed on 2026-03-23 by Codex. Validation: updated `.srgical/` docs were re-read and `node dist/index.js doctor` confirmed the planning pack remains present and usable. |
| PLAN002 | done | DIST001 | Refresh the planning pack to lock launch scope around Codex plus Claude Code CLI compatibility and queue the next implementation steps. | The pack reflects dual-agent launch scope, repo truth, and the next recommended implementation block. | Completed on 2026-03-24 by Codex. Validation: re-read the updated `.srgical/` docs and aligned current position to `ADAPT002`. |

## Phase 1 - Planning Studio Hardening

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| STUDIO001 | done | PLAN-001 | Persist the planning transcript and restore the last planning session when the studio reopens. | The studio no longer loses planning context on exit, and the restored transcript is visible when the user returns. | Completed on 2026-03-23 by Codex. Validation: `npm run build`, a compiled save-load roundtrip against `dist/core/studio-session.js`, and a short `node dist/index.js studio` startup smoke all passed. |
| STUDIO002 | done | STUDIO001 | Surface repo-aware execution context in the studio sidebar, including planning-pack state, next recommended step, and last execution outcome. | The studio sidebar reflects the actual repo state instead of only generic availability checks. | Completed on 2026-03-23 by Codex. Validation: `npm run build`, a compiled temp-workspace state roundtrip through `dist/core/execution-state.js` and `dist/core/planning-pack-state.js`, a short `node dist/index.js studio` startup smoke, and `node dist/index.js doctor` all passed. |
| STUDIO003 | done | STUDIO002 | Improve studio polish by fixing copy and encoding rough edges, strengthening "thinking" feedback, and making command guidance clearer. | The studio feels more premium and trustworthy during active planner calls. | Completed on 2026-03-23 by Codex. Validation: `npm run build`, a compiled default-session check against `dist/core/studio-session.js`, and a short `node dist/index.js studio` startup smoke all passed. Added clearer default studio guidance, a live elapsed-time activity ticker during planner and Codex calls, and stronger help and footer command copy. |

## Phase 2 - Pack Authoring Reliability

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| PACK001 | done | STUDIO003 | Enrich the planner-to-pack prompt with repo truth so pack generation is more deterministic and execution-ready. | Planner writes produce repo-specific plans with better structure and less generic filler. | Completed on 2026-03-23 by Codex. Validation: `npm run build`, a compiled prompt smoke check against `dist/core/prompts.js`, and `npm run doctor` all passed. Added repo-aware pack-writing context from package metadata, docs, file inventories, and existing `.srgical/` state. |
| PACK002 | done | PACK001 | Add safer local fallback behavior when Codex is unavailable, while preserving explicit user-triggered writes. | The user can still bootstrap or refresh a pack even when the live planner path is unavailable. | Completed on 2026-03-23 by Codex. Validation: `npm run build`, a compiled local fallback smoke check against `dist/core/local-pack.js`, and `npm run doctor` all passed. Added an explicit local `/write` fallback that creates missing pack files, preserves existing tracker state, and appends a dated kickoff entry when Codex is unavailable. |

## Phase 3 - Execution Loop Maturity

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC001 | done | PACK002 | Add repo-aware next-step summaries to `doctor` and the execution flow before running `run-next`. | The user can see what will execute next without opening the tracker manually. | Completed on 2026-03-23 by Codex. Validation: `npm run build`, `npm run doctor`, and a compiled `run-next` summary smoke check all passed. Added tracker-row parsing plus shared next-step summaries in `doctor` and before `run-next` execution. |
| EXEC002 | done | EXEC001 | Record `run-next` activity into durable local run logs under `.srgical/` with timestamps and final status summaries. | Execution runs leave a readable local trail for review and debugging. | Completed on 2026-03-23 by Codex. Validation: `npm run build`, `npm run doctor`, and a compiled `run-next` log smoke check all passed. Added `.srgical/execution-log.md` entries with timestamps, step labels, status, and summaries while preserving `execution-state.json` as the latest-run snapshot. |
| EXEC003 | done | EXEC002 | Add safer execution controls such as dry-run preview and clearer failure handling around write-enabled Codex runs. | The execution loop is more trustworthy and easier to recover when things go wrong. | Completed on 2026-03-23 by Codex. Validation: `npm run build`, `npm run doctor`, and a compiled execution-safety smoke check all passed. Added `run-next --dry-run`, studio `/preview`, and clearer recovery guidance for failed write-enabled runs. |

## Phase 4 - Adapter And Distribution Growth

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| ADAPT001 | done | EXEC003 | Introduce an adapter seam that keeps Codex first-class while making additional agents possible later. | The codebase has a clear agent abstraction without weakening the existing Codex path. | Completed on 2026-03-23 by Codex. Validation: `npm run build`, `npm run doctor`, `node dist/index.js run-next --dry-run`, and a compiled planner smoke check through `dist/core/agent.js` all passed. Added `src/core/agent.ts` as the primary agent seam, routed `doctor`, `studio`, and `run-next` through it, and kept Codex as the first-class default adapter. |
| DIST001 | done | ADAPT001 | Add release automation for production builds and define the path for `npm`, standalone binaries, and wrapper package-manager installs. | The repo has a concrete, testable distribution story beyond local development. | Completed on 2026-03-23 by Codex. Validation: `npm run build`, `npm run doctor`, and `npm run release:pack` all passed. Added release metadata and packaging inputs in `package.json`, a local release-bundle script plus `.github/workflows/release.yml`, and distribution docs covering npm, standalone-binary, and wrapper-manager paths. |

## Phase 5 - Multi-Agent Launch Compatibility

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| ADAPT002 | done | PLAN002 | Replace the single-primary-agent lookup with a registry that can enumerate supported adapters and resolve the active agent cleanly. | Core agent APIs can list installed adapters, resolve an active agent, and preserve current Codex behavior when it is the only available tool. | Completed on 2026-03-24 by Codex. Validation: `cmd /c npm run build`, `cmd /c npm test`, and `node dist/index.js doctor` all passed. Added a registry-backed agent core, Claude detection groundwork, and active-agent priming before `run-next` output. |
| SESSION001 | done | ADAPT002 | Persist the active agent for the current workspace session so studio and CLI flows can reopen with the same selected tool. | The workspace keeps session-scoped agent selection without changing the `.srgical/` planning-pack format. | Completed on 2026-03-24 by Codex. Validation: `cmd /c npm run build`, `cmd /c npm test`, and `node dist/index.js doctor` all passed. Extended `.srgical/studio-session.json` with a persisted `activeAgentId`, taught the agent core plus CLI flows to honor the stored selection, and added session-persistence coverage. |
| STUDIO004 | done | SESSION001 | Detect installed supported agents in the studio and let the user choose which one to use for the current session. | The studio shows truthful availability for Codex and Claude Code CLI and supports switching when more than one tool is installed. | Completed on 2026-03-24 by Codex. Validation: `cmd /c npm run build`, `cmd /c npm test`, and `node dist/index.js doctor` all passed. Added truthful studio agent status rendering, `/agents` plus `/agent <id>` commands, and single-available-agent auto-selection for new studio sessions. |
| DOCTOR002 | done | ADAPT002 | Teach `doctor` to report all supported agents plus the currently active one instead of only one primary adapter. | `doctor` output makes missing installs, availability, and the selected session agent obvious. | Completed on 2026-03-24 by Codex. Validation: `cmd /c npm test -- test/commands/doctor.test.ts`, `cmd /c npm run build`, and `node dist/index.js doctor` all passed. `doctor` now shows the active agent plus a supported-agent inventory while preserving the next-step summary block. |
| ADAPT003 | done | ADAPT002 | Add a dedicated Claude Code CLI adapter for planner replies, pack writes, and next-step execution. | Claude detection works on supported platforms and the adapter can power planner, write, and execution flows without changing the pack format. | Completed on 2026-03-24 by Codex. Validation: `cmd /c npm test -- test/core/claude.test.ts` (the current npm test script ran the full suite), `cmd /c npm run build`, and `node dist/index.js doctor` all passed. Claude now uses `claude -p` with appended prompt files, `plan` mode for planner replies, and `acceptEdits` plus allowlisted `Bash`/`Read`/`Edit`/`Write` permissions for pack writes and execution without using bypass-permissions mode. |
| EXEC004 | done | ADAPT003, SESSION001 | Allow `run-next` and related execution flows to honor the active session agent and optional per-command overrides. | Execution uses the selected agent by default and supports explicit overrides when the user wants a different tool for one run. | Completed on 2026-03-24 by Codex. Validation: `cmd /c npm test -- test/commands/run-next.test.ts test/core/agent.test.ts` (the current npm test script ran the full suite), `cmd /c npm run build`, `node dist/index.js run-next --dry-run --agent codex`, `node dist/index.js run-next --dry-run --agent claude`, and `node dist/index.js doctor` all passed with the expected success and missing-agent behaviors. Added a temporary `run-next --agent <id>` override path that does not persist the workspace session selection while keeping dry-run, logging, and failure handling adapter-agnostic. |
| TEST002 | done | STUDIO004, DOCTOR002, EXEC004 | Add adapter-registry and Windows command-resolution coverage for both supported agent CLIs. | Tests cover multi-agent detection, selection persistence, CLI overrides, and missing-agent failure cases. | Completed on 2026-03-24 by Codex. Validation: `cmd /c npm test -- test/core/codex.test.ts test/core/claude.test.ts test/core/agent.test.ts test/commands/run-next.test.ts` (the current npm test script ran the full suite), `cmd /c npm test`, `cmd /c npm run build`, and `node dist/index.js doctor` all passed. Added Codex runtime test hooks, Windows command-resolution coverage for both adapters, stale stored-selection coverage, and unavailable override failure coverage. |
| DOC002 | done | TEST002 | Refresh user docs for dual Codex and Claude launch support, setup, and current caveats. | README and relevant docs explain detection, selection, install prerequisites, and any Claude permission caveats. | Completed on 2026-03-24 by Codex. Validation: re-read `README.md`, `docs/product-foundation.md`, and `docs/distribution.md`; `rg -n 'Codex-only|One agent adapter|chat with Codex|through Codex|targets the \`codex\` CLI|only current agent path|one agent adapter|Codex as the only' README.md docs .srgical`; and `node dist/index.js doctor` all passed with only expected historical planning-pack matches. Updated the README plus product and distribution docs for dual-agent setup, selection, and current Claude caveats. |
