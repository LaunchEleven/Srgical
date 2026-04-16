<!-- SRGICAL:DOC_STATE {"version":1,"docKey":"context","state":"boilerplate"} -->

# Context

Updated: 2026-04-12T02:10:41.973Z
Updated By: srgical

## SRGICAL META

- doc role: evidence gathered so far, what is already true in the repo, and what still needs clarification
- scaffold status: context synced from imported implementation spec; overall plan remains pre-draft
- planning pack directory: `.srgical/plans/init/`

## Repo Truth

- The visible repo currently contains only `.srgical/` and `geo_brief_implementation_spec.md` at the top level.
- `geo_brief_implementation_spec.md` is the only substantive product or implementation document currently present in the workspace snapshot.
- `package.json` is not present, and `README.md`, `docs/product-foundation.md`, and `docs/adr/0001-tech-stack.md` are all missing in the provided repo snapshot.
- The active planning pack is `.srgical/plans/init/` and its `plan.md`, `tracker.md`, and `manifest.json` are still in an initial discover-state scaffold.
- The current plan and tracker do not yet contain a drafted outcome, confirmed implementation slices, or execution-ready build steps beyond `DISCOVER-001`.

## Evidence Gathered

- The imported spec defines the intended product as a repository-driven geopolitical briefing system that can run on cron, manual dispatch, local CLI, or future triggers without changing editorial semantics.
- The spec makes the written brief the canonical editorial artifact, with a public site as archive and reading surface, and Git history as the provenance trail.
- The intended editorial stance is explicit: each brief should be delta-aware, freshness-sensitive, continuity-aware, source-backed, and framed from an Australian perspective.
- The spec proposes a static-first, repo-centric pipeline with these major subsystems: trigger layer, collector, normalizer, deduplicator/clusterer, delta engine, scorer/ranker, brief composer, evidence presenter, repository writer, PR orchestrator, publisher, and configuration layer.
- The spec recommends, but does not confirm as implemented, a baseline stack of Node.js plus TypeScript, Astro for the site, Zod for validation, GitHub Actions for automation, and Git-only storage in v1.
- The target repository shape in the spec includes canonical dated outputs under `briefs/`, immutable per-run artifacts under `runs/`, editable configuration under `configs/`, implementation code under `src/`, a static site under `site/`, workflows under `.github/workflows/`, and tests under `tests/`.
- The spec expects normalized source models, story clustering, stable cross-run cluster matching, and explicit delta classification as `new`, `updated`, `continuing`, or `dropped`.
- The ranking model in the spec emphasizes global significance, Australian relevance, source strength, recency, continuity, and geopolitical/economic/defence impact rather than simple novelty.
- The source model in the spec separates mainstream reporting, official institutional sources, watched social accounts, and optional platform-specific sources, with a trust hierarchy that prefers official primary statements and reputable reporting over commentary or uncorroborated social claims.
- The brief output described in the spec includes markdown and machine-readable artifacts such as `brief.md`, `metadata.json`, `sources.json`, `clusters.json`, `delta.json`, `evidence.json`, and optional editorial notes.
- The operational workflow described in the spec is: ingest fresh material, compare against prior brief state, regenerate canonical date artifacts, create or update one PR for that date, and publish the site on merge.
- The spec phases the build: phase 1 covers the minimal delta-aware pipeline and PR flow; later phases add official and social adapters, the public site, editorial refinement controls, and advanced enhancements.
- The conversation transcript adds one clear process fact: prepare mode imported `geo_brief_implementation_spec.md` into the planning context, but no additional user outcome statement or repo code evidence has been supplied yet.

## Unknowns To Resolve

- Whether the immediate goal is to implement the full spec, to draft the first delivery slice, or to narrow the scope to a phase-1 MVP.
- Whether the preferred implementation stack should follow the spec recommendations exactly or be adjusted before drafting the plan.
- What existing code or prior experiments may exist outside the provided snapshot, since the current visible repo does not yet show application source, configs, workflows, or site files.
- Which initial source providers should be in scope for v1 article ingestion, and whether any API, scraping, or credential constraints already exist.
- How the Australian-angle logic should be operationalized first: rules/config, prompt logic, ranking weights, or a combination.
- What the first safe execution slice should be after discovery: scaffold repo structure, schema/config loading, article ingestion, delta engine, or markdown rendering.

## Working Agreements

- The human decides when there is enough context to move forward.
- Prepare can gather heavily, but it should not silently approve the plan.
- Operate executes one step by default and reports what changed after every run.
- Imported specs and planning notes should be treated as intended design evidence until the repo actually contains matching implementation.
- Repo truth should stay separate from aspirational architecture so later draft generation does not mistake recommendations for completed work.

## Product Direction For Srgical

- The product should become a polished web-first planning and execution cockpit rather than a transcript-heavy utility screen.
- The core philosophy is human-led deliberate application of software fundamentals with AI as a powerful collaborator, not AI-autopilot planning.
- The UI should make it obvious whether the team has actually captured enough outcome clarity, repo truth, constraints, risks, and first-slice thinking before drafting.
- Prepare mode should emphasize clarity, decisions, assumptions, risks, references, and next action over raw transcript volume.
- Context should become a first-class workspace rather than a side effect, with structure, freshness, provenance, and explicit integration of selected guidance.
- The future web shell should use stronger structure such as tabs, side drawers, progressive disclosure, and summary-first cards instead of many equal-weight panes.
- Long verbose content should default to concise summaries with expandable detail rather than forcing the user to scan dense text walls.
- The framework is both UX and prompt architecture: the tool should manage guidance, skills, prompt-library references, best-practice docs, and rule selections as explicit inputs to planning.
- Engineers should be able to select references manually, or ask the system to review the index and activate relevant references automatically.
- Selected references should be read by the agent, brought into the planning context, and recorded so the user can see what guidance is influencing the process.
- The tool must work for both deep projects and one-off small changes without forcing heavyweight ceremony on simpler work.
- Operate mode should visually distinguish execution actions from navigation, and “Return to Prepare” should be a clear navigation control rather than an operate action peer.
- The end-to-end workflow should ultimately support going from planning through execution to opening a PR without losing the planning context or decision trail.

## Golden Future UX Themes

- Introduce a stable application shell with top-level tabs such as Prepare, Context, References, Operate, and Review.
- Add a side drawer or utility rail for next action, warnings, recent changes, and execution state instead of mixing all status with core work surfaces.
- Make references and skills a dedicated workspace where engineers can browse, search, summarize, pin, and apply guidance packs.
- Separate summary surfaces from raw detail surfaces so that the main view stays calm while still allowing deep inspection on demand.
- Add a review/PR workflow that can summarize changes, selected guidance, risks, and testing posture before opening a PR.
