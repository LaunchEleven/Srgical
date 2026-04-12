# Studio Plan Tutorial

This guide is for the moment when `srgical studio plan` feels fuzzy:

- you have been talking through the problem
- `/write` is still blocked
- you are not sure whether the plan actually updated
- you are not sure when to run `/dice` or `/confirm-plan`

The short version is:

1. explore until the deterministic readiness checks are satisfied
2. sync the living `context.md` when you gather or import new material
3. use `/write` to turn the current context into the broader planning pack
4. inspect the written files with `/review` or `/open all`
5. optionally use `/dice` to break the plan into smaller execution slices
6. run `/confirm-plan` only when the current written or diced draft should become the approved execution baseline

## The Mental Model

`studio plan` is not rewriting the whole planning pack continuously while you chat.

The conversation transcript is one thing.
The `.srgical/plans/<id>/` markdown files are another thing.

The full plan files update when you explicitly run a draft action:

- `/write`: turn the current planning transcript into the first grounded draft, or refresh an existing draft
- `/dice [low|medium|high] [spike]`: rewrite the current draft into more explicit execution slices

`context.md` is different: gather/import/context-sync actions can refresh it earlier so imported evidence does not stay stranded in the transcript.

### What The `/dice` Args Mean

- `low`
  Coarser slicing with fewer, larger step blocks.
- `medium`
  Balanced slicing with practical PR-sized steps.
- `high`
  The smallest practical execution slices with the most explicit tracker detail.
- `spike`
  Allow an explicit `SPIKE-###` proof step before risky build work when the first seam needs validation.

Inside the rebooted prepare UI, `:slice --help` shows the same option guide, and `/dice --help` still works as a compatibility alias.

If you keep talking but never run `/write` or `/dice`, the transcript has changed, but the pack files have not.

## The Fastest Safe Workflow

From the repo you want to plan:

```powershell
srgical init my-plan
srgical doctor --plan my-plan
srgical studio plan --plan my-plan
```

Inside `studio plan`, use this sequence:

1. describe the goal, constraints, repo truth, and what V1 should include
2. run `/readiness`
3. if readiness is not enough, keep talking or use `/read <path>` to ground the conversation in repo files
4. if you import a longer external note or export, let `context.md` sync first
5. when readiness says draft write is ready, run `/write`
6. run `/review`
7. run `/open all` if you want to inspect the actual markdown files in your editor
8. if you want smaller implementation slices, run `/dice high`
9. once the current draft is the baseline you want execution to use, run `/confirm-plan`

The common command loop is:

```text
/readiness
/write
/review
/dice high
/review
/confirm-plan
```

## What `/readiness` Really Means

`/readiness` is the deterministic gate for whether `srgical` will actually allow `/write`.

It checks five signals:

- goal captured
- repo context captured
- constraints or decisions captured
- first executable slice captured
- explicit go-ahead captured

You do not need perfect product specs.
You do need enough signal that the plan can become execution-ready without guessing wildly.

The most important lines in the `/readiness` output are:

- `Draft write: ready now`
- `Draft write: not ready yet`
- `Missing: ...`

If `Draft write` is not ready yet, `srgical` will block `/write`.

## Why `/write` Gets Blocked

When `/write` is blocked, it usually means one of these is still missing:

- the problem is still too vague
- the repo truth is not grounded yet
- the constraints or locked decisions are still too implicit
- the first executable slice is still unclear

The usual fix is not "talk longer about everything."
The usual fix is to add the missing signal directly.

Examples:

- missing repo truth:
  use `/read README.md`, `/read package.json`, or `/read src/some-file.ts`
- missing constraints:
  say things like "use vanilla JS", "no backend", "must run locally", "defer auth"
- missing executable slice:
  say what the first implementation block should be, such as "create the static shell first, then wire state, then render the chart"
- missing explicit go-ahead:
  say "yes, write the pack", "lock that in", or "go ahead with that plan"

## The Smallest Useful Planning Conversation

If you want to get to `/write` quickly, use a structure like this:

1. what you are building
2. what is already true in the repo
3. what V1 includes
4. what is explicitly out of scope
5. the preferred stack or implementation shape
6. the first practical execution slice
7. explicit go-ahead

Example:

```text
I want a simple browser app that visualizes a Beta distribution updating from Bernoulli observations.
This workspace is greenfield except for srgical files.
V1 should be one page with a chart, success/failure buttons, autoplay, reset, and a stats panel.
Use plain HTML, CSS, and JavaScript. No backend and no heavy dependencies.
Break it into small steps: static shell first, then state/stats, then chart rendering, then autoplay.
Yes, lock that in and write the pack.
```

That is often enough to reach a writable state.

## How To Tell If The Plan Actually Updated

Use one or more of these checks:

1. run `/review`
2. run `/open all`
3. run `srgical doctor --plan <id>` in another shell

What to expect:

- before the first write:
  the pack is scaffolded and mostly boilerplate
- after `/write`:
  the docs become grounded, `PLAN-001` is usually done, and a first `EXEC-...` step is queued
- after `/dice`:
  the tracker becomes more explicit and the draft state becomes sliced
- after `/confirm-plan`:
  the approval state becomes approved

Outside studio, `doctor` is the cleanest truth source:

```powershell
srgical doctor --plan my-plan
```

Look for these fields:

- `Pack mode: authored`
- `Draft state: written` or `sliced`
- `Approval: approved` or `pending review / confirmation`
- `Next Step: EXEC-...`

## The Difference Between `/write`, `/dice`, and `/confirm-plan`

They do different jobs:

- `/write`
  sync the current transcript into the pack files
- `/dice`
  reshape the written plan into smaller or clearer execution slices
- `/confirm-plan`
  approve the current written or diced draft as the execution baseline

Important:

- `/write` does not automatically approve the plan
- `/dice` does not automatically approve the plan
- any later `/write` or `/dice` makes the previous approval stale

That means the normal sequence is:

```text
/write
/dice high
/confirm-plan
```

Or if you already like the first draft:

```text
/write
/confirm-plan
```

## What "Stale" Means

If you already approved a plan and then run `/write` or `/dice` again, the approval becomes stale.

That is intentional.
It means:

- the files changed
- the execution baseline changed
- you should review the new draft
- then run `/confirm-plan` again

If `doctor` or `studio` says approval is stale, the fix is simple:

1. inspect the updated pack
2. if you like it, run `/confirm-plan`

## Recommended Command Patterns

### Pattern A: First draft quickly

```text
/readiness
/write
/review
```

Use this when you want to see something concrete as early as possible.

### Pattern B: First draft, then tighter slicing

```text
/readiness
/write
/dice high
/review
/confirm-plan
```

Use this when you expect to run `run-next --auto` later and want small execution steps.

### Pattern C: Ground the conversation with repo files

```text
/read README.md
/read package.json
/read src/some-file.ts
/readiness
/write
```

Use this when `srgical` seems unsure about the repo.

## Troubleshooting

### "I have been chatting for a while and nothing changed on disk."

That is expected for `plan.md` and `tracker.md` until you run `/write` or `/dice`.

`context.md` may still update earlier when you gather/import material.

### "`/write` is blocked."

Run `/readiness` and look at the missing signals.
Then add only the missing information.

### "I wrote the plan, but I do not know if it is approved."

Run `/review`, then `/confirm-plan`, then `srgical doctor --plan <id>`.

### "I approved it, then changed it, and now execution is blocked."

The approval is stale.
Review the changed draft and run `/confirm-plan` again.

### "I do not know what the next action should be."

Use this rule:

- if no grounded draft exists: `/readiness` then `/write`
- if a draft exists but slices are too coarse: `/dice high`
- if the draft looks right but is not approved: `/confirm-plan`
- if the plan is approved and has a queued execution step: switch to `studio operate` or use `run-next`

## After Planning

Once the plan is approved:

```powershell
srgical run-next --plan my-plan --dry-run
srgical run-next --plan my-plan
```

Or for bounded automation:

```powershell
srgical run-next --plan my-plan --auto --max-steps 5
```

What to expect:

- `--dry-run` previews the current execution handoff without editing
- `run-next` executes one tracked step block
- `--auto` executes multiple tracked step blocks up to the limit

## One Good End-To-End Example

```powershell
srgical init beta-bayes-demo
srgical studio plan --plan beta-bayes-demo
```

Inside studio:

```text
I want a simple browser app that visualizes a Beta distribution being fit from Bernoulli observations.
Use a fixed Beta(1,1) prior.
V1 should include a chart, success/failure buttons, reset, autoplay, and a compact stats panel.
Use plain HTML, CSS, and JavaScript. No backend. No heavy dependencies.
Break it into small executable steps.
Yes, lock that in and write the pack.

/readiness
/write
/review
/dice high
/review
/confirm-plan
```

Then execute:

```powershell
srgical doctor --plan beta-bayes-demo
srgical run-next --plan beta-bayes-demo --dry-run
srgical run-next --plan beta-bayes-demo --auto --max-steps 5
```

If you remember only one thing, remember this:

The transcript is not the plan pack.
`/write` is the bridge.
