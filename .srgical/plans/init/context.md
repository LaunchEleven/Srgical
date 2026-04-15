<!-- SRGICAL:DOC_STATE {"version":1,"docKey":"context","state":"grounded"} -->

# Context

Updated: 2026-04-15T09:23:34.0197582Z
Updated By: srgical

## SRGICAL META

- doc role: evidence gathered so far, what is already true in the repo, and what still needs clarification
- scaffold status: context synced from repeated imported repo docs and transcript passes; pack is still pre-draft and awaiting an explicit V1 outcome
- planning pack directory: `.srgical/plans/init/`

## Repo Truth

- The workspace root is a monorepo with `apps/*` and `packages/*` workspaces plus repo-visible planning state under `.srgical/`.
- The root `package.json` identifies the repo as `srgical-monorepo`, marks it `private`, and requires Node.js `>=20`.
- The root manifest is an orchestration shell for workspaces rather than a dependency-bearing app package; the imported manifest shows no root dependencies or devDependencies.
- Root scripts delegate build, dev, start, status, and test flows into workspace packages, with the main CLI workspace currently referenced as `@launcheleven/srgical`.
- Release-oriented scripts already exist at the repo root for packing, publishing to GitHub Packages, publishing to npm, and reading release version/state.
- The README defines the current user-facing workflow as `prepare` -> approve -> `operate` -> repeat.
- The README states that `srgical prepare <id>` creates a plan pack under `.srgical/plans/<id>/` and opens the full-screen prepare studio.
- The README states that prepare supports direct context maintenance through `F2`, `:import <path>`, and `:context`, with `context.md` treated as a living document before draft build.
- The README documents the visible CLI surface as `prepare`, `operate`, `status`, `about`, `changelog`, and shell completion commands.
- The README also points users to `docs/studio-plan-tutorial.md` for a fuller walkthrough of the prepare experience.
- The README's development section defines the current contributor flow as `npm install`, `npm run build`, `npm test`, then `npm run dev -- prepare <id>`.
- The current pack already exists at `.srgical/plans/init/` with boilerplate `plan.md`, `context.md`, `tracker.md`, `changes.md`, and `manifest.json`.

## Evidence Gathered

- Imported `package.json` confirms the repo is organized as a private workspace monorepo and that root scripts are primarily orchestration entrypoints rather than the product implementation itself.
- Imported `README.md` positions `srgical` as a local-first CLI for planning work with an AI, writing a visible pack into the repo, and executing the next step cleanly.
- README quick-start material shows the intended prepare-studio loop:
  - talk to the planner in a dedicated full-screen UI
  - gather or import context directly into `context.md`
  - build a draft, slice it into steps, approve it, then switch to `operate`
- README notes that a fuller walkthrough of prepare lives in `docs/studio-plan-tutorial.md`, which is additional repo evidence available for later drafting if the team needs a deeper workflow reference.
- README development commands indicate the expected local contributor flow is `npm install`, `npm run build`, `npm test`, then `npm run dev -- prepare <id>`.
- README notes that legacy commands such as `doctor`, `init`, `studio`, and `run-next` are now redirect-only, which reinforces that the rebooted workflow centers on `prepare`, approval, and `operate`.
- Imported `docs/product-foundation.md` provides the strongest statement of product intent:
  - the product pattern is derived from a Writr migration flow with four durable primitives: stable plan, current-context handoff log, strict step tracker, and repeatable next-agent prompt
  - the thesis is a one-command entry into a planning studio that writes a tracker pack into the repo and lets teams keep executing without reconstructing state manually
  - non-negotiables are local-first behavior, explicit agent actions, markdown-first repo-visible workflow, incremental/resumable execution, and a TUI that does not feel like a boring debug console
  - V1 scope calls for three launch-scope agent adapters, one planning-pack format under `.srgical/`, one full-screen TUI, one execution command for the current next-step prompt, and truthful installed-tool detection with session-scoped active-agent selection
  - success criteria emphasize bootstrapping a new repo without prompt copy-paste, planning inside a dedicated interface, Writr-style familiarity, single-command execution continuation, and honest handling of missing or multiple supported agents
  - distribution strategy targets GitHub Packages, public npm, and standalone binaries for Windows, macOS, and Linux, with wrappers such as `brew` and `choco` layered on later
- Existing repo docs reinforce that current planning artifacts are meant to stay visible in-repo and that this context sync step is a first-class part of prepare, not a side effect.
- The transcript confirms the session is still in Discover stage and that the system keeps the next action fixed on either gathering more evidence or describing the desired outcome before building the first draft.
- The same three files were loaded multiple times across auto-sync and gather-sync passes, which reaffirms the current evidence base but does not materially expand it.
- Across those repeated sync passes, the system twice asked for the `init` plan's desired outcome in one concrete sentence and restated the ask as "say exactly what the first version should do."
- The sync summaries repeatedly preserved the same two unresolved seams as first-class unknowns: the missing concrete `init` outcome and the need to inspect real implementation seams in `apps/` and `packages/` to reconcile doc claims with code.
- The later transcript also records theme changes to `Amber Grid` and then `Neon Command`; these are UI-state events only and do not change repo truth, plan scope, or current unknowns.
- The most recent transcript event is another auto context sync starting immediately after the same three source files were loaded again, which suggests the current sync request is a continuation of the same evidence loop rather than the arrival of new factual input.

## Unknowns To Resolve

- The concrete outcome for the `init` prepare pack is still not stated by the human, even after the system explicitly asked what the first version should do.
- No first draft has been built yet, so there is still no confirmed problem statement, desired outcome, or step slicing for this pack.
- Source file inventory is unavailable, and the repeated gather/context-sync passes still did not add implementation inspection, so truth inside `apps/` and `packages/` is unreconciled against the README and product docs.
- The canonical supported-agent naming is not fully resolved from the imported material: README names `codex`, `claude`, and `auggie`, while product-foundation names `codex`, `claude`, and `augment`.
- Package naming and distribution details need confirmation across the repo because the imported material references both `@launcheleven/srgical` and `@launch11/srgical`.
- It is not yet confirmed how much of the product-foundation V1 scope is already implemented versus still aspirational.
- It is still unclear whether the next safe move after the human responds should be more repo inspection or draft-building, because the workflow is explicitly waiting on user direction for the first-version outcome.

## Working Agreements

- The human decides when there is enough context to move forward.
- This context sync should preserve repo truth and imported intent now, even before the full draft-build step exists.
- README and repo manifests count as stronger truth for current behavior than aspirational planning language; product-foundation content should guide the draft but not be mistaken for confirmed implementation.
- Naming mismatches or product-scope inconsistencies should stay visible in context until the repo or user resolves them.
- Re-importing the same source files should strengthen or clarify existing evidence, not create duplicated noise in the living context doc.
- Cosmetic studio events such as theme changes should be ignored unless they affect workflow behavior or reveal a product requirement.
- Prepare can gather heavily, but it should not silently approve the plan.
- Until the human states the target outcome for `init`, the pack should remain in discover mode and avoid pretending the execution slices are ready.
- Operate executes one step by default and reports what changed after every run.
