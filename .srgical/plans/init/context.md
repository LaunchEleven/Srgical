<!-- SRGICAL:DOC_STATE {"version":1,"docKey":"context","state":"grounded"} -->

# Context

Updated: 2026-04-15T23:59:00+10:00
Updated By: srgical

## SRGICAL META

- doc role: evidence gathered so far, what is already true in the repo, and what still needs clarification
- scaffold status: boilerplate until the first real draft exists
- planning pack directory: `.srgical/plans/init/`

## Repo Truth

- This repo is a Node-based monorepo rooted at `G:\code\Launch11Projects\srgical` with `apps/*` and `packages/*` workspaces.
- The root package is `srgical-monorepo`, marked `private: true`, and requires Node `>=20`.
- The root `package.json` currently does not declare a package `version` field; version/release state is instead surfaced through dedicated root scripts.
- The main root workflow scripts delegate to workspace packages, especially `@launcheleven/srgical` for `dev`, `start`, `status`, `test`, and `test:coverage`.
- The root `build` flow currently depends on four workspace builds in sequence: `@srgical/studio-shared`, `@srgical/studio-core`, `@srgical/studio-web`, and `@launcheleven/srgical`.
- Release and publishing workflows already exist at the repo root through `scripts/release-pack.mjs`, `scripts/publish-github.mjs`, `scripts/publish-npm.mjs`, `scripts/read-package-version.mjs`, and `scripts/read-release-state.mjs`.
- The repo already documents the rebooted product loop as `prepare -> approve -> operate -> repeat`.
- The prepare workflow writes visible planning-pack state under `.srgical/`, and `context.md` is explicitly intended to be refreshed directly from gathered/imported material before draft build.
- The active prepare pack is `.srgical/plans/init/`, and the scaffolded pack files already exist for `plan.md`, `context.md`, `tracker.md`, `changes.md`, and `manifest.json`.
- Product docs already define the core product shape as a local-first, markdown-first planning and execution system with a full-screen planning studio and incremental execution loop.
- The accepted initial stack decision is TypeScript on Node using `commander` for CLI commands, `blessed` for the full-screen TUI, and native child-process spawning for Codex orchestration.
- The README's documented local development loop is `npm install`, `npm run build`, `npm test`, then `npm run dev -- prepare <id>`.

## Evidence Gathered

- Imported `package.json` confirms the repo is organized as a private monorepo with `apps/*` and `packages/*` workspaces, Node `>=20`, and script coverage for build, dev, start, status, test, coverage, and release/publish tasks.
- The same imported `package.json` also confirms there is no root `version` field in the current manifest snapshot, so package versioning should not be assumed from the monorepo root file alone.
- Imported `README.md` states the product promise plainly: `srgical` is a local-first CLI that helps plan work with an AI, turns that plan into a visible pack inside the repo, and then executes the next step cleanly.
- `README.md` confirms the primary user workflow:
  - `srgical prepare <id>` creates or reopens a plan pack and opens the full-screen prepare studio.
  - Inside prepare, `F2` gathers context, `:import <path>` syncs a document into `context.md`, `:context` refreshes `context.md`, `F3` builds the draft, `F4` slices the plan, and `F6` approves it.
  - `srgical operate <id>` runs execution after approval, with variants for `--dry-run`, `--auto --max-steps <n>`, and `--checkpoint`.
- `README.md` also confirms supported local agent expectations for install/use today: at least one of `codex`, `claude`, or `auggie` must be installed and working.
- `README.md` includes a concrete developer workflow for running the product locally: install dependencies, build, run tests, then enter prepare mode through `npm run dev -- prepare release-readiness`.
- Imported `docs/product-foundation.md` gives higher-level intent and constraints:
  - The product is modeled on a four-part durable planning/execution pattern from `Writr\migrations-part-5`.
  - Non-negotiables are local-first behavior, explicit agent actions, markdown-first repo-visible workflow, and execution that is incremental, resumable, and validation-aware.
  - V1 scope includes three launch-scope adapters (`codex`, `claude`, `augment`), one planning-pack format under `.srgical/`, one full-screen TUI, one execution command for the current next-step prompt, and truthful installed-tool detection plus session-scoped active-agent selection.
  - V1 success criteria emphasize no manual prompt copy-paste, planning in a dedicated UI, familiar Writr-style pack output, single-command execution looping, and honest reporting/selection of installed tools.
- `docs/product-foundation.md` also narrows the release/distribution posture: GitHub Packages uses `@launcheleven/srgical`, npm public uses `@launch11/srgical`, semver is driven via git tags in GitHub Actions, and standalone binaries are intended for Windows, macOS, and Linux.
- The conversation transcript confirms this prepare session is still in Discover stage and the system-directed next action remains: gather more evidence or describe the desired outcome before building the first draft.
- The transcript also confirms that `package.json`, `README.md`, and `docs/product-foundation.md` were explicitly loaded into the prepare session more than once as context sources, so their content is established imported planning evidence rather than guesswork.
- The transcript adds one explicit planning blocker that should remain visible in context:
  - After the first auto context sync, the system asked the human to "say exactly what the first version should do."
  - No answer to that request appears in the supplied transcript, so the first-version outcome is still unresolved.
- There is one terminology mismatch to preserve as evidence rather than normalize away yet:
  - `README.md` names supported local CLIs as `codex`, `claude`, or `auggie`.
  - `docs/product-foundation.md` names V1 launch-scope adapters as `codex`, `claude`, and `augment`.
  - This may reflect a rename, packaging distinction, or stale documentation and should stay visible until confirmed.

## Unknowns To Resolve

- Desired outcome not confirmed yet.
- The clearest missing input from the transcript is still: what, exactly, should the first version do?
- This pack is still the generic `init` prepare pack; the concrete initiative, change target, or first deliverable has not been stated in the transcript yet.
- The first real draft has not been built, so there is no confirmed problem statement, desired outcome, risk frame, or execution slice list yet.
- The source file inventory was unavailable in the current snapshot, so current implementation status inside `apps/` and `packages/` is not yet captured in this context doc.
- The adapter naming mismatch between `auggie` in `README.md` and `augment` in `docs/product-foundation.md` needs confirmation.
- If versioning matters for the plan, the relevant package manifest or release source still needs to be inspected because the root `package.json` does not carry a version field.
- No repo-level validation has been run in this context-sync action, so build/test health is still unknown.

## Working Agreements

- The human decides when there is enough context to move forward.
- Prepare can gather heavily, but it should not silently approve the plan.
- Operate executes one step by default and reports what changed after every run.
- Treat imported source files and transcript-loaded documents as first-class evidence for `context.md`, especially before the first draft exists.
- Prefer concrete repo truth from imported files and existing docs over speculative planning language.
- Keep the prepare pack aligned to the rebooted workflow described in `README.md`: context sync can happen before draft build, approval is explicit, and execution should only follow an approved plan.
- Preserve useful discrepancies in the evidence section when docs conflict instead of flattening them into a false certainty.
- Treat repeated transcript prompts as signal: if the system keeps asking for the first-version outcome, that missing decision stays an active unknown until the human answers it directly.
