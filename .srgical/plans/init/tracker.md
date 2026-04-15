<!-- SRGICAL:DOC_STATE {"version":1,"docKey":"tracker","state":"boilerplate"} -->

# Tracker

Updated: 2026-04-15T13:38:50.924Z
Updated By: srgical

## SRGICAL META

- doc role: execution-ready steps for the active plan
- scaffold status: boilerplate until the first real draft exists
- writing conventions:
  - prefer small, shippable steps
  - every step needs clear acceptance and validation
  - use spike steps when a risky seam needs fast proof before build work

## Status Legend

- `todo`: not started
- `doing`: currently in progress
- `blocked`: waiting on a blocker
- `done`: completed and validated
- `skipped`: intentionally skipped

## Type Legend

- `research`: evidence gathering or clarification
- `spike`: fast proof to reduce risk
- `build`: implementation work
- `validate`: focused verification or hardening
- `rollout`: release, migration, or follow-through work

## Current Position

- Last completed: `BOOT-001`
- Next step: `DISCOVER-001`
- Updated at: `2026-04-15T13:38:50.924Z`
- Updated by: `srgical`

## Steps

| ID | Type | Status | Depends On | Scope | Acceptance | Validation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BOOT-001 | research | done | - | Create the new prepare pack scaffold. | The visible plan files and manifest exist. | Scaffold files written successfully. | Completed during pack creation. |
| DISCOVER-001 | research | todo | BOOT-001 | Confirm the desired outcome, current repo truth, and first safe slice. | The first draft can be built without guessing wildly. | Review gathered evidence and confirm enough context exists. | Pending first prepare pass. |
