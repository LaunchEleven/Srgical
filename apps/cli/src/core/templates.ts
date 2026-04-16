import path from "node:path";
import { stampPlanningDocumentState } from "./planning-doc-state";
import { createDefaultManifest } from "./plan-manifest";
import type { PlanningPackPaths } from "./workspace";

function projectNameFromRoot(root: string): string {
  return path.basename(root);
}

export function buildPlanTemplate(root: string): string {
  const projectName = projectNameFromRoot(root);

  return stampPlanningDocumentState(
    `# ${projectName} Plan

Updated: ${new Date().toISOString().slice(0, 10)}
Updated By: srgical

## SRGICAL META

- doc role: stable outcome, confirmed decisions, and the seams this plan is protecting
- scaffold status: boilerplate until the first real draft exists
- writing conventions:
  - separate confirmed decisions, working assumptions, and open unknowns
  - keep the desired outcome concrete
  - prefer repo truth over generic architecture filler

## Problem

- Pending first draft.

## Desired Outcome

- Pending first draft.

## Confirmed Decisions

- Pending first draft.

## Working Assumptions

- Pending first draft.

## Open Unknowns

- Pending first draft.

## Risks

- Pending first draft.
`,
    "plan",
    "boilerplate"
  );
}

export function buildContextTemplate(paths: PlanningPackPaths): string {
  return stampPlanningDocumentState(
    `# Context

Updated: ${new Date().toISOString()}
Updated By: srgical

## SRGICAL META

- doc role: evidence gathered so far, what is already true in the repo, and what still needs clarification
- scaffold status: boilerplate until the first real draft exists
- planning pack directory: \`${paths.relativeDir}/\`

## Repo Truth

- Pending first draft.

## Evidence Gathered

- Pending first auto-gather pass.

## Unknowns To Resolve

- Desired outcome not confirmed yet.
- Execution slices not prepared yet.

## Working Agreements

- The human decides when there is enough context to move forward.
- Prepare can gather heavily, but it should not silently approve the plan.
- Operate executes one step by default and reports what changed after every run.

## Selected Guidance In Effect

- No guidance documents selected yet.
`,
    "context",
    "boilerplate"
  );
}

export function buildTrackerTemplate(): string {
  return stampPlanningDocumentState(
    `# Tracker

Updated: ${new Date().toISOString()}
Updated By: srgical

## SRGICAL META

- doc role: execution-ready steps for the active plan
- scaffold status: boilerplate until the first real draft exists
- writing conventions:
  - prefer small, shippable steps
  - every step needs clear acceptance and validation
  - use spike steps when a risky seam needs fast proof before build work

## Status Legend

- \`todo\`: not started
- \`doing\`: currently in progress
- \`blocked\`: waiting on a blocker
- \`done\`: completed and validated
- \`skipped\`: intentionally skipped

## Type Legend

- \`research\`: evidence gathering or clarification
- \`spike\`: fast proof to reduce risk
- \`build\`: implementation work
- \`validate\`: focused verification or hardening
- \`rollout\`: release, migration, or follow-through work

## Current Position

- Last completed: \`BOOT-001\`
- Next step: \`DISCOVER-001\`
- Updated at: \`${new Date().toISOString()}\`
- Updated by: \`srgical\`

## Steps

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BOOT-001 | research | done | - | Create the new prepare pack scaffold. | The visible plan files and manifest exist. | Scaffold files written successfully. | Completed during pack creation. |
| DISCOVER-001 | research | todo | BOOT-001 | Confirm the desired outcome, current repo truth, and first safe slice. | The first draft can be built without guessing wildly. | Review gathered evidence and confirm enough context exists. | Pending first prepare pass. |
`,
    "tracker",
    "boilerplate"
  );
}

export function buildChangesTemplate(): string {
  return stampPlanningDocumentState(
    `# Changes

Updated: ${new Date().toISOString()}
Updated By: srgical

## SRGICAL META

- doc role: visible summary of what changed after each refine or operate action
- scaffold status: boilerplate until the first real change summary exists

## Latest Summary

- Created the initial prepare pack.

## History

### ${new Date().toISOString()} - BOOT-001

- Docs changed: plan.md, context.md, tracker.md, changes.md, manifest.json
- Context added: initial prepare scaffold
- Steps added or edited: BOOT-001, DISCOVER-001
- Next step change: none -> DISCOVER-001
- Validation: scaffold files written successfully
`,
    "changes",
    "boilerplate"
  );
}

export function buildManifestTemplate(paths: PlanningPackPaths): string {
  return JSON.stringify(createDefaultManifest(paths.planId), null, 2);
}

export function getInitialTemplates(paths: PlanningPackPaths): Record<string, string> {
  return {
    [paths.plan]: buildPlanTemplate(paths.root),
    [paths.context]: buildContextTemplate(paths),
    [paths.tracker]: buildTrackerTemplate(),
    [paths.changes]: buildChangesTemplate(),
    [paths.manifest]: buildManifestTemplate(paths)
  };
}
