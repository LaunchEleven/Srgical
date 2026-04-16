<!-- SRGICAL:DOC_STATE {"version":1,"docKey":"context","state":"grounded"} -->

# Context

Updated: 2026-04-17T00:00:00Z
Updated By: srgical

## SRGICAL META

- doc role: evidence gathered so far, what is already true in the repo, and what still needs clarification
- scaffold status: boilerplate until the first real draft exists
- planning pack directory: `.srgical/plans/init/`

## Repo Truth

- This repo is a monorepo rooted at `G:\code\Launch11Projects\srgical` with workspaces under `apps/*` and `packages/*`.
- The package manifest names the repo `srgical-monorepo`, marks it `private`, and requires Node.js `>=20`.
- Top-level npm scripts route the main developer workflow through the published CLI package `@launcheleven/srgical` for `dev`, `start`, `status`, and test execution.
- The build pipeline currently composes four workspace builds in order: `@srgical/studio-shared`, `@srgical/studio-core`, `@srgical/studio-web`, and `@launcheleven/srgical`.
- Release support already exists in-repo through `scripts/release-pack.mjs`, `scripts/publish-github.mjs`, `scripts/publish-npm.mjs`, `scripts/read-package-version.mjs`, and `scripts/read-release-state.mjs`.
- The repo already contains product and engineering docs that define the current direction, including `docs/product-foundation.md`, `docs/adr/0001-tech-stack.md`, `docs/distribution.md`, `docs/studio-plan-tutorial.md`, and `docs/testing-strategy.md`.
- The README positions `srgical` as a local-first CLI that writes visible planning state under `.srgical/` and runs a loop of `prepare`, approval, `operate`, and repeat.
- The README's development flow is currently `npm install`, `npm run build`, `npm test`, and `npm run dev -- prepare <id>`, so local development still goes through the packaged CLI entrypoint instead of a separate studio-only tool.
- The README also states that legacy commands such as `doctor`, `init`, `studio`, and `run-next` now only redirect users toward the rebooted workflow.
- The active prepare pack is `.srgical/plans/init/`, and the existing tracker is still at the initial discover stage with `DISCOVER-001` as the next pending step.
- The current prepare session remains in Discover stage, and the visible next action is still to ask for the concrete desired outcome for the `init` plan in one sentence before gathering a narrower implementation seam.
- Checkpoint mode is enabled in the active prepare session, which is relevant session behavior but does not change the plan content on its own.
- The latest visible gather activity is still loading only `package.json`, `README.md`, and `docs/product-foundation.md`; no narrower `apps/` or `packages/` seam has been grounded yet.

## Evidence Gathered

- Imported `package.json` confirms the repo is organized as a workspace monorepo and that the current developer entrypoints are intentionally thin wrappers around the main CLI package rather than ad hoc root scripts.
- Imported `README.md` adds concrete workflow truth for the current product surface:
  - `srgical prepare <id>` creates or reopens a plan pack under `.srgical/plans/<id>/` and opens the full-screen prepare studio.
  - Prepare-mode commands already include `:import <path>` to sync a specific document into `context.md`, `:context` to refresh context from transcript plus evidence, `F3` to build the draft, `F4` to slice steps, and `F6` to approve.
  - Operate mode already exposes `--dry-run`, `--auto --max-steps <n>`, and `--checkpoint` variants.
  - Install guidance currently expects npm install of `@launch11/srgical` plus at least one local agent CLI: `codex`, `claude`, or `auggie`.
  - The README's development section confirms the normal local loop remains repo-local and CLI-driven: install dependencies, build, run tests, then launch prepare through `npm run dev -- prepare <id>`.
  - The README explicitly points fuller prepare UX walkthroughs to `docs/studio-plan-tutorial.md`, which is relevant supporting documentation if the draft later needs interaction details.
- Imported `docs/product-foundation.md` captures the deeper product intent behind the workflow:
  - The product is modeled after a four-part Writr-style system: stable plan, current-context handoff log, strict step tracker, and repeatable next-agent prompt.
  - The core thesis is that teams should be able to plan in a dedicated studio, write the pack into the repo, and continue execution without reconstructing state manually.
  - Non-negotiables are local-first behavior, explicit agent actions, markdown-first repo-visible workflow, incremental and resumable execution, and a TUI that does not feel like a generic debug console.
  - V1 scope calls for launch-scope adapters for `codex`, `claude`, and `augment`, one `.srgical/` planning-pack format, one full-screen TUI, one execution command for the next-step prompt, and truthful installed-tool detection with session-scoped agent selection.
  - V1 success criteria emphasize single-command bootstrap, planning in a dedicated interface, familiarity with the Writr-style system, single-command next-step execution, and honest reporting when supported agents are missing or multiple.
  - Distribution strategy is split between GitHub Packages as `@launcheleven/srgical`, npm public as `@launch11/srgical`, semver via git tags and GitHub Actions, and standalone binaries for Windows, macOS, and Linux.
- The transcript confirms this prepare session is still in Discover stage, and the planner has not yet been given a user-authored desired outcome beyond gathering repo and product context.
- The transcript now shows the same three sources being loaded repeatedly across multiple auto-sync passes, which reinforces that the current context is based on repeated grounding in `package.json`, `README.md`, and `docs/product-foundation.md` rather than newly broadened repo inspection.
- The transcript also confirms that context sync is an explicit first-class studio action, not a side effect to defer until a later draft build.
- The latest visible system guidance in prepare is still to ask for the concrete desired outcome for the `init` plan in one sentence, then gather only the matching `apps/` or `packages/` area before drafting.
- The planner also surfaced that requirement directly to the user as: the first version still needs to be stated plainly before the draft can move forward.
- The transcript records theme changes to Amber Grid and later Neon Command; these are session-state changes only and do not affect plan content.
- The transcript records checkpoint mode being enabled during the session; this affects operate behavior expectations but does not supply missing product or implementation scope.
- The transcript repeats the same planner ask twice in direct terms: "say exactly what the first version should do," which is the clearest current blocker to moving beyond discovery.
- The latest gather pass is still reloading the same three context files and shows "Gather Context Sync is running...", so the evidence base remains broad product/workflow grounding rather than code-seam discovery.
- Selected references now in effect expand the grounded evidence beyond the three imported files to include `docs/adr/0001-tech-stack.md`, `docs/distribution.md`, `docs/studio-plan-tutorial.md`, and `docs/testing-strategy.md`.
- Those selected references add useful current guidance:
  - ADR 0001 confirms the accepted initial implementation stack is TypeScript on Node with `commander`, `blessed`, and native child-process spawning for Codex orchestration.
  - `docs/distribution.md` sharpens release truth: current production channels are GitHub Packages, public npm, and GitHub Releases; versioning is tag-driven; and the package does not bundle agent CLIs.
  - `docs/studio-plan-tutorial.md` reinforces the prepare mental model that transcript changes and pack-file writes are separate, and that `context.md` is the one document intended to refresh earlier during gather/import flows.
  - `docs/testing-strategy.md` frames current quality priorities around command safety, pack integrity, adapter behavior, and release verification, with an executable baseline already identified for tests around planning-pack state, execution state, `doctor`, and `run-next`.
- The selected references also preserve a fuller legacy-to-rebooted workflow picture that matters for later drafting:
  - `docs/studio-plan-tutorial.md` still documents legacy aliases such as `studio plan`, `/write`, `/dice`, and `/confirm-plan`, but it aligns with the same underlying rule that explicit readiness and explicit write/confirm actions gate pack changes.
  - `docs/testing-strategy.md` makes clear that legacy commands like `doctor`, `init`, `run-next`, and `studio` still matter for regression coverage even if README-facing product language has shifted toward `prepare` and `operate`.

## Unknowns To Resolve

- The desired outcome for the `init` prepare pack is still not explicitly stated by the user; current evidence describes the product and workflow but not the specific change, release goal, or implementation target this pack should drive.
- The first safe execution slice has not been identified yet because there is still no confirmed draft outcome to decompose.
- Repo-level file inventories were provided, but source-file inventory details are still unavailable, so implementation seams inside `apps/` and `packages/` remain unverified and should only be gathered after the desired outcome is pinned down.
- Product-foundation notes say V1 scope includes adapters for `codex`, `claude`, and `augment`, while the README install requirements mention `codex`, `claude`, and `auggie`; that naming mismatch needs confirmation before a draft treats agent support as settled truth.
- The exact package/workspace mapping for `@launcheleven/srgical` versus the public install name `@launch11/srgical` is implied by docs and scripts but not yet reconciled in this context pack.
- The selected references introduce legacy and rebooted command language side by side, such as `doctor`, `init`, `studio plan`, `/write`, and `/dice`, while the README foregrounds `prepare`, `operate`, `:build`, and `:slice`; the intended user-facing command canon for this plan still needs to be treated carefully.
- The current gather loop has not produced any new imported file beyond the same three core docs, so it remains unknown which concrete repo seam should be inspected first once the user states the goal.

## Working Agreements

- Treat `context.md` as the live evidence log for prepare; imported files and transcript facts should be folded here before draft generation when they materially sharpen repo truth.
- The human decides when there is enough context to move forward.
- Prefer confirmed repo and transcript facts over assumptions, especially when product docs and README language diverge.
- Preserve high-signal imported material with enough fidelity that later draft generation can rely on it without reopening the same files unless code-level seams are needed.
- Prepare can gather heavily, but it should not silently approve the plan.
- Operate executes one step by default and reports what changed after every run.
- Follow the explicit prepare guidance from the transcript: get the plan outcome in one sentence first, then inspect only the matching `apps/` or `packages/` area instead of broad repo spelunking.
- Treat repeated gather passes over the same broad product docs as confirmation of current workflow truth, not as a substitute for the missing implementation target.
- Until the user states the target outcome for `init`, this pack should remain in discovery mode and avoid pretending the repo-wide product direction is the same thing as the plan goal.
- Carry forward selected-reference guidance when it sharpens repo truth: treat `context.md` as the early-sync evidence log, reserve broader pack rewrites for explicit draft actions, and keep command/release/testing notes visible when they materially constrain the plan.
- Keep both rebooted and legacy command language visible where it affects correctness, but do not collapse the distinction into a false claim that the user-facing command canon is already settled.

## Selected Guidance In Effect

- `README.md`: `context.md` is a living document that gather/import actions can refresh directly before the full draft is built, and the current rebooted user flow is `prepare` -> approve -> `operate`.
- `docs/product-foundation.md`: the product should preserve the four-part Writr-style planning pattern, stay local-first and markdown-visible, and keep execution incremental, resumable, and explicit.
- `docs/adr/0001-tech-stack.md`: the accepted initial stack is TypeScript on Node with `commander`, `blessed`, and native child-process spawning for Codex orchestration.
- `docs/distribution.md`: release truth currently includes dual package publishing (`@launcheleven/srgical` and `@launch11/srgical`), tag-driven semver, GitHub Releases artifacts, and separate local installation of supported agent CLIs.
- `docs/studio-plan-tutorial.md`: transcript updates do not automatically rewrite the planning pack, `context.md` is the one document meant to sync earlier, and draft/slicing actions should stay explicit.
- `docs/testing-strategy.md`: later planning should respect the current testing emphasis on command safety, pack integrity, agent/platform regressions, and release verification rather than assuming manual smoke testing is enough.

<!-- SRGICAL:SELECTED_GUIDANCE_SECTION -->

## Selected Guidance In Effect



### srgical
- Path: `README.md`
- Summary: `srgical` is a local-first CLI for planning work with an AI, turning that plan into a visible pack inside your repo, and then executing the next step cleanly.
- Tags: testing, ai, delivery

### ADR 0001: Initial Stack
- Path: `docs/adr/0001-tech-stack.md`
- Summary: Accepted on 2026-03-23
- Tags: architecture, ai, delivery

### Distribution Guide
- Path: `docs/distribution.md`
- Summary: The current production release channels are GitHub Packages for npm, the public npm registry, and GitHub Releases.
- Tags: testing, ai, security, delivery

### Product Foundation
- Path: `docs/product-foundation.md`
- Summary: The system in `Writr\migrations-part-5` has four durable primitives:
- Tags: ai, delivery

### Studio Plan Tutorial
- Path: `docs/studio-plan-tutorial.md`
- Summary: This guide is for the moment when `srgical studio plan` feels fuzzy:
- Tags: testing, architecture, ai, security, delivery

### Testing Strategy
- Path: `docs/testing-strategy.md`
- Summary: This plan turns the current srgical CLI into a continuously verifiable tool instead of a repo that only relies on
- Tags: testing, ai, delivery

<!-- /SRGICAL:SELECTED_GUIDANCE_SECTION -->
