# Next Agent Prompt

You are continuing the `srgical` CLI effort from the existing repo state. Do not restart product design, discard the
current TypeScript foundation, or casually rewrite the project from scratch.

## Read Order

1. Read `.srgical/02-agent-context-kickoff.md`.
2. Read `.srgical/01-product-plan.md`.
3. Read `.srgical/03-detailed-implementation-plan.md`.
4. Re-open the repo files most relevant to the chosen next step before editing.

## What To Determine Before Editing

1. Identify `Last Completed` and `Next Recommended` in the tracker.
2. Confirm the next eligible step or contiguous step block.
3. Only choose 1 to 2 contiguous steps when all of the following are true:
   - they are in the same phase,
   - they touch the same subsystem,
   - they still fit comfortably in context,
   - they do not introduce a new design decision.
4. Only choose more than 2 steps if the tracker clearly keeps the work mechanical and low-risk.
5. Preserve the locked decisions in `01-product-plan.md` unless the tracker explicitly requires otherwise.

## Execution Rules

1. Announce the chosen step ID or step IDs before making substantive edits.
2. Execute the chosen step block end-to-end.
3. Keep the work incremental, validation-aware, and repo-specific.
4. Preserve the `.srgical/` workflow, explicit AI actions, and the terminal-first studio direction.
5. Do not silently broaden scope into a new subsystem.
6. Run validation appropriate to the step block.
7. If a blocker changes scope materially, stop immediately after recording it.
8. Do not silently skip tracker updates.
9. Record agent-specific caveats honestly, especially where Claude Code CLI behavior differs from Codex behavior.

## Required Updates After Execution

1. Update `.srgical/03-detailed-implementation-plan.md`.
2. Mark finished steps `done` only if validation actually passed.
3. Update the `Notes` column for every touched step with a concise implementation and validation note.
4. Update `Current Position` in `.srgical/03-detailed-implementation-plan.md`:
   - `Last Completed`
   - `Next Recommended`
   - `Updated At`
   - `Updated By`
5. Append a short dated entry to `.srgical/02-agent-context-kickoff.md` under `Handoff Log`:
   - step IDs worked
   - files touched
   - validation run
   - blockers or follow-up notes
   - next recommended step

## Stop Conditions

- Stop after finishing the chosen step block, even if more work remains.
- Stop before crossing into a different phase unless the tracker explicitly supports that scope.
- Stop if a new architecture or product decision is required and record that need instead of making it casually.

## Design Constraints To Preserve

- `.srgical/` remains the canonical planning-pack format
- TypeScript on Node remains the implementation stack for the current phase
- Codex CLI and Claude Code CLI are both launch-scope adapters
- current Codex behavior should not regress while Claude support is added
- installed-tool detection and session-scoped active-agent selection should stay truthful and local-first
- the studio remains terminal-first and transcript-first
- AI actions remain explicit and user-triggered
- the interface should keep a bold, intentional visual direction
- execution should remain incremental and validation-aware
