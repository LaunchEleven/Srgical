import path from "node:path";
import type { PlanningPackPaths } from "./workspace";

function projectNameFromRoot(root: string): string {
  return path.basename(root);
}

export function buildPlanTemplate(root: string): string {
  const projectName = projectNameFromRoot(root);

  return `# ${projectName} Product Plan

Updated: ${new Date().toISOString().slice(0, 10)}

## Purpose

This file is the stable high-level plan for the current project. It should capture the architecture direction, the
workflow shape, and the non-negotiable product rules that each execution slice must preserve.

## Mission

Define and ship a local-first CLI that helps a user:

1. plan a project with an AI inside a dedicated interface,
2. write a tracker pack into the repo,
3. execute the next eligible delivery slice with AI support,
4. keep progress incremental, validated, and resumable.

## Locked Decisions

- planning packs live under \`.srgical/\`
- the workflow remains markdown-first and repo-visible
- AI actions remain explicit and user-triggered
- execution should happen in small validated slices
- the interface should feel intentionally designed, not merely functional

## Primary Workflow To Optimize

1. open a studio
2. talk to the planner
3. trigger plan-pack generation
4. run the next eligible step block
5. review validation and continue

## Target End State

- the tool owns the planning ritual instead of relying on repeated prompt pastes
- the pack format stays readable by humans and agents
- agent execution can resume cleanly from repo state
- the UI feels like a sharp creative control room
`;
}

export function buildContextTemplate(paths: PlanningPackPaths): string {
  const planDir = `\`${paths.relativeDir}/\``;

  return `# Agent Context Kickoff

Updated: ${new Date().toISOString()}
Updated By: srgical

## Mission

Continue the current project from the planning pack in ${planDir}. Read the stable plan, the tracker, and the next
agent prompt before making changes.

## Working Agreements

- execute only the next eligible step or contiguous low-risk step block
- keep changes incremental and validated
- update the tracker and this handoff log after each completed block
- stop when a blocker changes scope materially

## Current Position

- Last Completed: \`BOOT-001\`
- Next Recommended: \`PLAN-001\`
- Updated At: \`${new Date().toISOString()}\`
- Updated By: \`srgical\`

## Handoff Log

### ${new Date().toISOString().slice(0, 10)} - BOOT-001 - srgical

- Created the initial \`.srgical/\` planning pack.
- Active planning directory: \`${paths.relativeDir}\`.
- Validation: confirmed the four planning-pack files were written.
- Blockers: none.
- Next recommended work: \`PLAN-001\`.
`;
}

export function buildTrackerTemplate(): string {
  return `# Detailed Implementation Plan

Updated: ${new Date().toISOString()}
Updated By: srgical

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

## Bootstrap

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| BOOT-001 | done | - | Create the planning-pack scaffold. | The \`.srgical/\` pack exists. | Completed during \`srgical init\`. |

## Planning

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| PLAN-001 | pending | BOOT-001 | Convert the planning conversation into a stable product plan, kickoff log, tracker, and next-agent prompt. | The pack reflects the real project direction and is ready for execution. | Pending planner write. |

## Delivery

| ID | Status | Depends On | Scope | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- |
| EXEC-001 | pending | PLAN-001 | Execute the next eligible implementation slice from the tracker. | The selected slice is complete, validated, and logged. | Pending tracker detail. |
  `;
}

export function buildHandoffTemplate(paths: PlanningPackPaths): string {
  const planDir = paths.relativeDir;

  return `# HandoffDoc

This is the canonical execution handoff for the current plan.

${buildExecutionHandoffBody(planDir)}
`;
}

export function buildNextPromptTemplate(paths: PlanningPackPaths): string {
  const planDir = paths.relativeDir;

  return `# Next Agent Prompt

Compatibility document retained for older workflows.
The canonical execution handoff now lives in \`${planDir}/HandoffDoc.md\`.

${buildExecutionHandoffBody(planDir)}
`;
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
  return `You are continuing the current project from the existing repo state. Do not restart product design or casually rewrite
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
