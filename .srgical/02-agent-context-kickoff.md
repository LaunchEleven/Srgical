# Agent Context Kickoff

Updated: 2026-03-24T22:51:16.9641094+11:00
Updated By: Codex

## Mission

Continue from the existing `srgical` CLI scaffold and make the current launch compatible with both locally installed
Codex CLI and Claude Code CLI paths. Preserve the repo-visible `.srgical/` workflow, keep the product local-first, and
extend the existing adapter seam incrementally instead of rewriting the project around a new architecture.

## Locked Decisions

- `.srgical/` remains the canonical on-disk planning-pack format.
- TypeScript on Node remains the current implementation stack.
- Launch scope must support both Codex CLI and Claude Code CLI.
- The studio remains terminal-first and transcript-first.
- AI actions remain explicit and user-triggered.
- The planning pack remains agent-neutral even as runtime adapters expand.
- The UI should detect installed supported tools truthfully and let the user choose the active agent for the current
  session.
- Codex behavior should not regress while Claude support is added.
- Incremental execution with validation and tracker updates remains the core operating model.

## Current Repo Truth

- The repo already builds successfully with TypeScript and has installed dependencies.
- The CLI currently exposes `doctor`, `init`, `studio`, and `run-next`.
- The studio already has a strong first-pass visual shell built with Blessed, including a transcript pane, status
  sidebar, input composer, and slash commands.
- The codebase now has a registry-backed agent seam in `src/core/agent.ts`, and the CLI plus studio flow through it.
- That seam can now enumerate supported adapters and resolve an active agent dynamically instead of always returning
  Codex.
- The Codex adapter already resolves the local executable on Windows and can run both read-only and write-enabled
  `codex exec` calls.
- The Claude adapter in `src/core/claude.ts` now resolves the local executable on Windows and can run planner,
  pack-writing, and execution flows through non-interactive `claude -p` calls with prompt-file handoff.
- The studio now persists and restores its transcript plus the workspace session's selected active agent through
  `.srgical/studio-session.json`.
- The studio sidebar already reflects planning-pack status, tracker current position, and the latest execution outcome
  from `.srgical/execution-state.json`.
- The studio can now show truthful supported-agent availability and switch the workspace session choice through
  `/agents` and `/agent <id>`.
- `doctor` and `run-next` already summarize the next recommended tracker step before execution.
- `doctor` now reports the active session agent plus all supported agent statuses, and `run-next` still honors the
  stored workspace agent selection.
- `run-next` now also supports a one-shot `--agent <id>` override that changes only the current execution path and
  leaves the stored workspace session agent untouched.
- Claude planner replies now run in `plan` permission mode, while Claude pack-writing and execution runs use
  `acceptEdits` with allowlisted local tools instead of bypass-permissions mode.
- The execution loop already has safer controls through dry-run preview, durable logs, and failure recovery guidance.
- The repo already has a concrete npm-first distribution path, release manifests, and a tagged GitHub Actions release
  workflow.
- Adapter-registry tests now cover stale session selections, unavailable override failures, and Windows command
  resolution for both Codex and Claude through stubbed runtime checks.
- User-facing docs now describe dual-agent launch support, truthful detection, session selection, install prerequisites,
  and the current Claude permission caveat instead of framing the product as Codex-only.
- Live local validation on 2026-03-24 shows `codex` installed and runnable (`codex-cli 0.113.0`) while `claude` is
  not currently installed on this machine, so Claude runtime validation in this block relied on stubbed adapter tests
  plus a build and doctor smoke instead of a live Claude CLI execution.

## Working Agreements

- Read the current `.srgical/` files before making substantive edits.
- Execute only the next eligible step or contiguous low-risk step block.
- Prefer 1 to 2 contiguous steps at a time; only take more when the work is mechanical and stays in one subsystem.
- Keep changes incremental and validated.
- Update the tracker and this handoff log after each completed block.
- Stop immediately if a blocker materially changes scope.

## Current Position

- Last Completed: `DOC002`
- Next Recommended: none queued
- Updated At: `2026-03-24T22:51:16.9641094+11:00`
- Updated By: `Codex`

## Handoff Log

### 2026-03-23 - BOOT-001 - srgical

- Created the initial `.srgical/` planning pack.
- Validation: confirmed the four planning-pack files were written.
- Blockers: none.
- Next recommended work: `PLAN-001`.

### 2026-03-23 - PLAN-001 - Codex

- Replaced the generic bootstrap pack with a repo-specific plan, tracker, and next-agent prompt grounded in the
  current TypeScript CLI scaffold.
- Captured the real repo truth: a working Codex-backed planning studio exists, but transcript persistence, richer
  execution state, stronger pack authoring, and distribution work are still ahead.
- Set the next recommended work to `STUDIO001` so execution starts by hardening the planning studio instead of jumping
  across subsystems too early.
- Validation: re-read the updated pack files and confirmed the repo still reports a valid planning-pack state through
  `node dist/index.js doctor`.
- Blockers: none.
- Next recommended work: `STUDIO001`.

### 2026-03-23 - STUDIO001 - Codex

- Added transcript persistence for the planning studio so messages now save to `.srgical/studio-session.json` and are
  restored the next time the studio opens.
- Introduced `src/core/studio-session.ts`, extended workspace path helpers with a studio-session location, and updated
  `src/ui/studio.ts` so each appended transcript message is persisted immediately.
- Validation: `npm run build`; a compiled roundtrip save-load check against `dist/core/studio-session.js`; startup smoke
  via `node dist/index.js studio` launched briefly and stayed alive until terminated.
- Blockers: none.
- Next recommended work: `STUDIO002`.

### 2026-03-23 - STUDIO002 - Codex

- Added a repo-aware planning-pack state reader and a lightweight latest-execution state file so the studio sidebar can
  show real pack presence, tracker current position, and the last run outcome instead of generic availability labels.
- Introduced `src/core/planning-pack-state.ts` and `src/core/execution-state.ts`, extended workspace paths with
  `.srgical/execution-state.json`, updated `src/ui/studio.ts` to render the richer sidebar context, and updated
  `src/commands/run-next.ts` plus the studio `/run` path to persist the latest execution status.
- Validation: `npm run build`; a compiled temp-workspace roundtrip through `dist/core/execution-state.js` and
  `dist/core/planning-pack-state.js`; startup smoke via `node dist/index.js studio`; `node dist/index.js doctor`.
- Blockers: none.
- Next recommended work: `STUDIO003`.

### 2026-03-23 - STUDIO003 - Codex

- Worked step: `STUDIO003`.
- Files touched: `src/ui/studio.ts`, `src/core/studio-session.ts`, `.srgical/02-agent-context-kickoff.md`,
  `.srgical/03-detailed-implementation-plan.md`.
- Implemented clearer default studio copy, stronger `/help` and footer guidance, and a live elapsed-time activity
  ticker for planner, pack-writing, and execution runs.
- Validation: `npm run build`; compiled default-session check against `dist/core/studio-session.js`; startup smoke via
  `node dist/index.js studio`.
- Blockers or follow-up notes: none.
- Next recommended step: `PACK001`.

### 2026-03-23 - PACK001 - Codex

- Worked step: `PACK001`.
- Files touched: `src/core/prompts.ts`, `src/core/codex.ts`, `.srgical/02-agent-context-kickoff.md`,
  `.srgical/03-detailed-implementation-plan.md`.
- Added a repo-aware pack-writing prompt that now includes package metadata, key docs, source and docs inventories,
  and the existing `.srgical/` files so `/write` can refine the pack from real repo state instead of transcript-only
  context.
- Validation: `npm run build`; compiled prompt smoke check against `dist/core/prompts.js`; `npm run doctor`.
- Blockers or follow-up notes: none.
- Next recommended step: `PACK002`.

### 2026-03-23 - PACK002 - Codex

- Worked step: `PACK002`.
- Files touched: `src/core/local-pack.ts`, `src/core/codex.ts`, `src/ui/studio.ts`,
  `.srgical/02-agent-context-kickoff.md`, `.srgical/03-detailed-implementation-plan.md`.
- Added a safe local pack-writing fallback so explicit `/write` calls still refresh the planning pack when Codex is
  unavailable by creating missing files, preserving existing tracker state, and appending a dated kickoff entry.
- Validation: `npm run build`; compiled local fallback smoke check against `dist/core/local-pack.js`; `npm run doctor`.
- Blockers or follow-up notes: none.
- Next recommended step: `EXEC001`.

### 2026-03-23 - EXEC001 - Codex

- Worked step: `EXEC001`.
- Files touched: `src/core/planning-pack-state.ts`, `src/commands/doctor.ts`, `src/commands/run-next.ts`,
  `.srgical/02-agent-context-kickoff.md`, `.srgical/03-detailed-implementation-plan.md`.
- Added tracker-row parsing so the current next recommended step can be summarized in `doctor` and printed immediately
  before `run-next` executes the prompt.
- Validation: `npm run build`; `npm run doctor`; compiled `run-next` summary smoke check with a stubbed Codex call.
- Blockers or follow-up notes: none.
- Next recommended step: `EXEC002`.

### 2026-03-23 - EXEC002 - Codex

- Worked step: `EXEC002`.
- Files touched: `src/core/workspace.ts`, `src/core/execution-state.ts`, `src/commands/run-next.ts`,
  `.srgical/02-agent-context-kickoff.md`, `.srgical/03-detailed-implementation-plan.md`.
- Added durable markdown execution history under `.srgical/execution-log.md` so `run-next` now records timestamped
  success and failure entries with the selected step label and a concise final summary.
- Validation: `npm run build`; `npm run doctor`; compiled `run-next` log smoke check covering both success and failure.
- Blockers or follow-up notes: none.
- Next recommended step: `EXEC003`.

### 2026-03-23 - EXEC003 - Codex

- Worked step: `EXEC003`.
- Files touched: `src/core/execution-controls.ts`, `src/commands/run-next.ts`, `src/index.ts`, `src/ui/studio.ts`,
  `.srgical/02-agent-context-kickoff.md`, `.srgical/03-detailed-implementation-plan.md`.
- Added a true dry-run preview for `run-next`, studio `/preview`, and clearer recovery messaging for failed
  write-enabled runs so the user can inspect the next step safely and recover faster when execution fails.
- Validation: `npm run build`; `npm run doctor`; compiled execution-safety smoke check covering dry-run and failure
  guidance.
- Blockers or follow-up notes: none.
- Next recommended step: `ADAPT001`.

### 2026-03-23 - ADAPT001 - Codex

- Worked step: `ADAPT001`.
- Files touched: `src/core/agent.ts`, `src/core/execution-controls.ts`, `src/commands/doctor.ts`,
  `src/commands/run-next.ts`, `src/index.ts`, `src/ui/studio.ts`, `.srgical/02-agent-context-kickoff.md`,
  `.srgical/03-detailed-implementation-plan.md`.
- Added a primary-agent adapter seam so the CLI and studio now resolve planner, pack-writing, status, and execution
  calls through `src/core/agent.ts` while keeping Codex as the default first-class adapter.
- Validation: `npm run build`; `npm run doctor`; `node dist/index.js run-next --dry-run`; compiled planner smoke check
  through `dist/core/agent.js` returning `adapter-path-ok`.
- Blockers or follow-up notes: none.
- Next recommended step: `DIST001`.

### 2026-03-23 - DIST001 - Codex

- Worked step: `DIST001`.
- Files touched: `package.json`, `.gitignore`, `README.md`, `LICENSE`, `docs/distribution.md`,
  `scripts/release-pack.mjs`, `.github/workflows/release.yml`, `.srgical/02-agent-context-kickoff.md`,
  `.srgical/03-detailed-implementation-plan.md`.
- Added a production distribution path built around `npm run release:pack`, release-manifest outputs under
  `.artifacts/release/`, publish-ready package metadata, and a tagged GitHub Actions release workflow.
- Validation: `npm run build`; `npm run doctor`; `npm run release:pack`, producing `.artifacts/release/srgical-0.1.0.tgz`
  and matching release manifests.
- Blockers or follow-up notes: standalone binaries and wrapper package managers are now defined in docs and release
  workflow expectations, but not implemented yet.
- Next recommended step: none currently tracked.

### 2026-03-24 - PLAN002 - Codex

- Worked step: `PLAN002`.
- Files touched: `.srgical/01-product-plan.md`, `.srgical/02-agent-context-kickoff.md`,
  `.srgical/03-detailed-implementation-plan.md`, `.srgical/04-next-agent-prompt.md`.
- Replaced the stale demo-oriented product plan with the real `srgical` launch direction, locked dual Codex and Claude
  Code CLI compatibility into the planning pack, and queued the multi-agent implementation sequence.
- Validation: re-read the updated `.srgical/` files; confirmed the tracker now points to `ADAPT002` as the next
  recommended step and records the new launch-scope decisions explicitly.
- Blockers or follow-up notes: Claude is still not installed on this machine, so detection and missing-tool UX remain
  important parts of the upcoming implementation.
- Next recommended step: `ADAPT002`.

### 2026-03-24 - ADAPT002 - Codex

- Worked step: `ADAPT002`.
- Files touched: `src/core/agent.ts`, `src/core/claude.ts`, `src/commands/run-next.ts`,
  `test/core/agent.test.ts`, `.srgical/01-product-plan.md`, `.srgical/02-agent-context-kickoff.md`,
  `.srgical/03-detailed-implementation-plan.md`.
- Replaced the single hardcoded primary-agent lookup with a registry-backed seam that can enumerate supported adapters,
  resolve the active agent dynamically, and keep the selected runtime path in sync for downstream callers.
- Added Claude detection groundwork with explicit, honest placeholder runtime errors so the repo can detect Claude
  today without pretending `ADAPT003` is already complete.
- Validation: `cmd /c npm run build`; `cmd /c npm test`; `node dist/index.js doctor`.
- Blockers or follow-up notes: Claude runtime flows still intentionally fail with a clear `ADAPT003` message until the
  dedicated adapter work lands, and session-scoped active-agent persistence is still pending.
- Next recommended step: `SESSION001`.

### 2026-03-24 - SESSION001, STUDIO004 - Codex

- Worked steps: `SESSION001`, `STUDIO004`.
- Files touched: `src/core/studio-session.ts`, `src/core/agent.ts`, `src/ui/studio.ts`, `src/commands/doctor.ts`,
  `src/commands/run-next.ts`, `test/core/studio-session.test.ts`, `test/core/agent.test.ts`,
  `test/commands/run-next.test.ts`, `.srgical/02-agent-context-kickoff.md`,
  `.srgical/03-detailed-implementation-plan.md`.
- Validation: `cmd /c npm run build`; `cmd /c npm test`; `node dist/index.js doctor`.
- Blockers or follow-up notes: Claude is still not installed on this machine, and Claude planner, pack-writing, plus
  execution flows still intentionally stop behind `ADAPT003`, so the new studio selector reports Claude truthfully but
  cannot exercise the full Claude runtime path yet.
- Next recommended step: `DOCTOR002`.

### 2026-03-24 - DOCTOR002 - Codex

- Worked step: `DOCTOR002`.
- Files touched: `src/commands/doctor.ts`, `test/commands/doctor.test.ts`,
  `.srgical/02-agent-context-kickoff.md`, `.srgical/03-detailed-implementation-plan.md`.
- Validation: `cmd /c npm test -- test/commands/doctor.test.ts`; `cmd /c npm run build`; `node dist/index.js doctor`.
- Blockers or follow-up notes: local validation still shows Codex installed and Claude missing on this Windows machine,
  and the current Claude detection path surfaces the raw missing-command message until `ADAPT003` deepens that adapter.
- Next recommended step: `ADAPT003`.

### 2026-03-24 - ADAPT003 - Codex

- Worked step: `ADAPT003`.
- Files touched: `src/core/claude.ts`, `src/core/local-pack.ts`, `src/core/codex.ts`, `test/core/claude.test.ts`,
  `.srgical/02-agent-context-kickoff.md`, `.srgical/03-detailed-implementation-plan.md`.
- Validation: `cmd /c npm test -- test/core/claude.test.ts`; `cmd /c npm run build`; `node dist/index.js doctor`.
- Blockers or follow-up notes: Claude is still not installed on this Windows machine, so the new runtime path was
  validated through stubbed adapter tests rather than a live `claude -p` execution. The current Claude adapter uses
  `plan` mode for planning and `acceptEdits` plus allowlisted `Bash`/`Read`/`Edit`/`Write` permissions for
  non-interactive writes and execution, which keeps bypass-permissions mode out of the default path but may still need
  refinement once a live Claude install is available.
- Next recommended step: `EXEC004`.

### 2026-03-24 - EXEC004 - Codex

- Worked step: `EXEC004`.
- Files touched: `src/core/agent.ts`, `src/commands/run-next.ts`, `src/index.ts`, `test/core/agent.test.ts`,
  `test/commands/run-next.test.ts`, `.srgical/02-agent-context-kickoff.md`,
  `.srgical/03-detailed-implementation-plan.md`.
- Validation: `cmd /c npm test -- test/commands/run-next.test.ts test/core/agent.test.ts`; `cmd /c npm run build`;
  `node dist/index.js run-next --dry-run --agent codex`; `node dist/index.js run-next --dry-run --agent claude`;
  `node dist/index.js doctor`.
- Blockers or follow-up notes: live local validation still shows Codex installed and Claude missing on this Windows
  machine, so the new one-run override path now succeeds for `--agent codex` and fails clearly for `--agent claude`
  without changing the stored workspace selection.
- Next recommended step: `TEST002`.

### 2026-03-24 - TEST002 - Codex

- Worked step: `TEST002`.
- Files touched: `src/core/codex.ts`, `test/core/codex.test.ts`, `test/core/claude.test.ts`,
  `test/core/agent.test.ts`, `test/commands/run-next.test.ts`, `test/helpers/platform.ts`,
  `.srgical/02-agent-context-kickoff.md`, `.srgical/03-detailed-implementation-plan.md`.
- Validation: `cmd /c npm test -- test/core/codex.test.ts test/core/claude.test.ts test/core/agent.test.ts test/commands/run-next.test.ts`;
  `cmd /c npm test`; `cmd /c npm run build`; `node dist/index.js doctor`.
- Blockers or follow-up notes: Codex is installed locally, but Claude is still missing on this Windows machine, so the
  new Claude Windows-resolution coverage relies on stubbed runtime tests rather than a live `claude` invocation.
- Next recommended step: `DOC002`.

### 2026-03-24 - DOC002 - Codex

- Worked step: `DOC002`.
- Files touched: `README.md`, `docs/product-foundation.md`, `docs/distribution.md`,
  `.srgical/02-agent-context-kickoff.md`, `.srgical/03-detailed-implementation-plan.md`.
- Validation: re-read `README.md`, `docs/product-foundation.md`, and `docs/distribution.md`;
  `rg -n 'Codex-only|One agent adapter|chat with Codex|through Codex|targets the \`codex\` CLI|only current agent path|one agent adapter|Codex as the only' README.md docs .srgical`;
  `node dist/index.js doctor`.
- Blockers or follow-up notes: Codex is still the only live-installed agent on this Windows machine, so the docs now
  explain Claude support honestly but live local validation for Claude remains limited to missing-agent behavior.
- Next recommended step: none queued.
