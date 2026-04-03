import path from "node:path";
import { stampPlanningDocumentState } from "./planning-doc-state";
import type { PlanningPackPaths } from "./workspace";

function projectNameFromRoot(root: string): string {
  return path.basename(root);
}

export function buildPlanTemplate(root: string): string {
  const projectName = projectNameFromRoot(root);

  return stampPlanningDocumentState(
    `# ${projectName} Product Plan

Updated: ${new Date().toISOString().slice(0, 10)}
Updated By: srgical

## SRGICAL META

- doc role: stable product direction and execution framing
- scaffold status: boilerplate only until the first grounded draft is written
- source inputs: planning transcript, repo truth, explicit user decisions, current constraints
- writing conventions:
  - separate locked decisions, working assumptions, and unknowns
  - prefer concrete repo truth over generic best practice wording
  - keep SOLID, loose DDD seams, telemetry, logging, and feature flags in view when they matter

## Problem Statement

- Pending first authored draft.

## Desired Outcome

- Pending first authored draft.

## Locked Decisions

- Pending first authored draft.

## Working Assumptions

- Pending first authored draft.

## Risks And Watchouts

- Pending first authored draft.
`,
    "plan",
    "boilerplate"
  );
}

export function buildContextTemplate(paths: PlanningPackPaths): string {
  const planDir = `\`${paths.relativeDir}/\``;

  return stampPlanningDocumentState(
    `# Agent Context Kickoff

Updated: ${new Date().toISOString()}
Updated By: srgical

## SRGICAL META

- doc role: current repo truth, working agreements, and handoff trail for the active plan
- scaffold status: boilerplate only until the first grounded draft is written
- planning pack directory: ${planDir}
- writing conventions:
  - summarize what is true in the repo today, not what we hope becomes true later
  - record blockers, validation, and why the next step is next

## Current Repo Truth

- Pending first authored draft.

## Working Agreements

- Execute only the next eligible step or a tiny contiguous step block.
- Keep validation, logging, and rollout considerations visible.
- Stop when scope meaningfully changes or new architecture work is required.

## Current Position

- Last Completed: \`BOOT-001\`
- Next Recommended: \`PLAN-001\`
- Updated At: \`${new Date().toISOString()}\`
- Updated By: \`srgical\`

## Handoff Log

### ${new Date().toISOString().slice(0, 10)} - BOOT-001 - srgical

- Created the initial planning scaffold in \`${paths.relativeDir}\`.
- Validation: scaffold files were written successfully.
- Next recommended work: \`PLAN-001\`.
`,
    "context",
    "boilerplate"
  );
}

export function buildTrackerTemplate(): string {
  return stampPlanningDocumentState(
    `# Detailed Implementation Plan

Updated: ${new Date().toISOString()}
Updated By: srgical

## SRGICAL META

- doc role: execution tracker and slicing plan
- scaffold status: boilerplate only until the first grounded draft is written
- intended evolution: start with planning and slicing, then become the execution source of truth
- writing conventions:
  - prefer evolutionarily small steps
  - acceptance should be validation-aware and concrete
  - note telemetry, feature-flag, and rollout considerations when relevant

## Status Legend

- \`pending\`: not started
- \`in_progress\`: currently being executed
- \`done\`: completed and validated
- \`blocked\`: cannot proceed without resolving a blocker
- \`skipped\`: intentionally skipped by an explicit design decision

## Current Position

- Last Completed: \`BOOT-001\`
- Next Recommended: \`PLAN-001\`
- Updated At: \`${new Date().toISOString()}\`
- Updated By: \`srgical\`

## Step Rules

- Work 1 to 2 contiguous steps only when they stay in the same subsystem and still fit comfortably in context.
- Do not mark a step \`done\` without recording validation notes.
- Update the current position and handoff log after each completed block.
- Stop immediately when a blocker changes scope materially.
- Prefer slices that could plausibly land as tiny PRs.

## Bootstrap

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| BOOT-001 | done | - | Create the planning-pack scaffold. | The \`.srgical/\` pack exists. | Completed during \`srgical init\`. |

## Planning

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| PLAN-001 | pending | BOOT-001 | Turn the planning conversation into the first grounded draft of this pack. | The pack reflects real repo truth, constraints, and a first executable slice. | Pending first authored draft. |

## Delivery

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC-001 | pending | PLAN-001 | Placeholder for the first execution slice. Replace during the first grounded draft. | The first real execution slice is defined with validation and rollout notes. | Pending tracker detail. |
  `,
    "tracker",
    "boilerplate"
  );
}

export function buildHandoffTemplate(paths: PlanningPackPaths): string {
  const planDir = paths.relativeDir;

  return stampPlanningDocumentState(
    `# HandoffDoc

This is the canonical execution handoff for the current plan.

## SRGICAL META

- doc role: execution handoff used by operate mode and direct run-next flows
- scaffold status: boilerplate only until the first grounded draft is written
- writing conventions:
  - keep scope incremental
  - call out validation, telemetry, and rollout expectations when relevant
  - stop before broadening into a larger subsystem without an explicit tracked reason

${buildExecutionHandoffBody(planDir)}
`,
    "handoff",
    "boilerplate"
  );
}

export function buildNextPromptTemplate(paths: PlanningPackPaths): string {
  const planDir = paths.relativeDir;

  return stampPlanningDocumentState(
    `# Next Agent Prompt

Compatibility document retained for older workflows.
The canonical execution handoff now lives in \`${planDir}/HandoffDoc.md\`.

## SRGICAL META

- doc role: compatibility mirror of HandoffDoc.md
- scaffold status: boilerplate only until the first grounded draft is written
- writing conventions: keep this aligned with the canonical handoff

${buildExecutionHandoffBody(planDir)}
`,
    "nextPrompt",
    "boilerplate"
  );
}

export function getInitialTemplates(paths: PlanningPackPaths): Record<string, string> {
  return {
    [paths.plan]: buildPlanTemplate(paths.root),
    [paths.context]: buildContextTemplate(paths),
    [paths.tracker]: buildTrackerTemplate(),
    [paths.nextPrompt]: buildNextPromptTemplate(paths),
    [paths.handoff]: buildHandoffTemplate(paths)
  };
}

function buildExecutionHandoffBody(planDir: string): string {
  return `This scaffold is intentionally lightweight until the first grounded draft is written.

You are continuing the current project from the existing repo state. Do not restart product design or casually rewrite
the whole codebase.

## Read Order

1. Read \`${planDir}/02-agent-context-kickoff.md\`.
2. Read \`${planDir}/01-product-plan.md\`.
3. Read \`${planDir}/03-detailed-implementation-plan.md\`.
4. Execute only the next eligible step block.

## What To Determine Before Editing

1. Identify \`Last Completed\` and \`Next Recommended\` in the tracker.
2. Confirm the next eligible step or contiguous low-risk step block.
3. Keep scope incremental and validation-aware.

## Execution Rules

1. Announce the chosen step ID or step IDs before making substantive edits.
2. Execute the step block end-to-end.
3. Preserve the locked product decisions from the plan.
4. Run validation appropriate to the step block.
5. Update the tracker and kickoff log when the block is complete.

## Required Updates After Execution

1. Update \`${planDir}/03-detailed-implementation-plan.md\`.
2. Mark finished steps \`done\` only if validation passed.
3. Update the \`Current Position\` section.
4. Append a dated handoff entry to \`${planDir}/02-agent-context-kickoff.md\`.

## Stop Conditions

- Stop after finishing the chosen step block.
- Stop before broadening into a different subsystem unless the tracker explicitly calls for it.
- Stop and record a blocker if new architecture work is required.`;
}
