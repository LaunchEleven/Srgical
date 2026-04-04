# srgical

`srgical` is a local-first orchestration CLI for the workflow you have already been using manually:

1. talk to an AI until the plan is sharp,
2. write a five-file planning pack into the repo,
3. repeatedly execute the next eligible step,
4. force validation and handoff updates every time.

The current launch slice supports local `codex`, local `claude`, and local `auggie` installs through the same
`.srgical/` workflow. `srgical` detects which supported tools are actually installed, keeps the planning pack
agent-neutral, and lets you choose the active agent for the current workspace session.

## Quick Start

Install `srgical`, then make sure at least one supported local agent CLI is installed (`codex`, `claude`, or `auggie`).

```bash
npm install -g @launch11/srgical
srgical doctor --plan release-readiness
```

Create a named plan pack (required):

```bash
srgical init release-readiness
# or
srgical init --plan release-readiness
```

Open studio and build context:

```bash
srgical studio release-readiness
# or
srgical studio plan --plan release-readiness
# shortcut
srgical ssp release-readiness
# or
srgical ssp --plan release-readiness
```

Inside `studio plan`:

1. talk through scope/constraints and use `/readiness` + `/advice`
2. interrogate plan quality with `/assess [focus]`, `/gather [focus]`, `/gaps [focus]`, and `/ready [focus]`
3. inject repo files directly with `/read [path]` (press `Tab` to autocomplete file paths; omit `path` to read the current directory non-recursively)
4. run `/write` whenever you want to sync the current grounded draft from transcript context
5. run `/dice [low|medium|high] [spike]` whenever you want to rewrite or refine the pack into evolutionary execution slices
6. run `/review` and `/open all` (or `/open <path>`) for human doc review
7. run `/confirm-plan` when the current written or sliced draft should become the approved execution baseline
8. keep iterating with `/write` and `/dice`; any later change makes approval stale until you confirm again

Need a concrete walkthrough for when `/write` is blocked or it is unclear whether the pack changed? See
`docs/studio-plan-tutorial.md`.

Configure operate-mode checkpoints and references:

```bash
srgical studio config --plan release-readiness --pause-pr --set-reference docs/operate-guidelines.md
# shortcut
srgical ssc --plan release-readiness --pause-pr --set-reference docs/operate-guidelines.md
```

Run delivery automation in `studio operate`:

```bash
srgical studio operate --plan release-readiness
# shortcut
srgical sso --plan release-readiness
```

Inside `studio operate`, use `/go` to run the configured operate flow (`/stop` requests stop after current iteration).
If auto mode halts because the current step is `blocked`, run `/unblock` (or `/unblock <STEP_ID>`) to stage a retry, then run `/go` again.
Use `/unblock analyze [focus]` when you want root-cause guidance first.

CLI execution path:

```bash
srgical run-next --plan release-readiness --dry-run
srgical run-next --plan release-readiness
srgical run-next --plan release-readiness --auto --max-steps 10
```

## Why This Exists

The reference system in `G:\code\Launch11Projects\Writr\migrations-part-5` is strong because it does not just create a
plan. It creates momentum:

- a stable architecture file,
- a current-context handoff log,
- a step-by-step tracker,
- and a canonical execution handoff document that keeps execution disciplined.

`srgical` turns that from a repeated copy-paste ritual into a product.

## Current Slice

This repo currently ships the foundation for:

- `srgical --version`
  Prints the installed version with release-note links instead of only echoing the semver.
- interactive startup
  Shows a cached upgrade notice when a newer public npm release is available via `npm i -g @launch11/srgical`.
- `srgical doctor`
  Reports the active plan, plan readiness, execution state, auto-run state, and which supported agents are available
  locally, along with any cached AI advice for the selected plan.
- `srgical about`
  Shows package details, release links, and the currently supported agent adapters.
- `srgical changelog`
  Points straight at the installed version's release notes and the local packaged changelog.
- `srgical init`
  Creates a named local `.srgical/plans/<id>/` planning pack from built-in templates. Pass either `srgical init <id>` or `srgical init --plan <id>`.
- `srgical studio plan`
  Opens the full-screen planning studio (`ssp` shortcut) where you can switch named plans, gather repo context,
  iterate toward practical sufficiency, write/refresh the planning pack, and use `/dice [low|medium|high] [spike]`
  to break a grounded plan into smaller evolutionary slices.
- `srgical studio operate`
  Opens the full-screen operate studio (`sso` shortcut) with execution-focused commands (`/go`, `/run`, `/auto`,
  `/stop`, `/unblock`) and optional pause-for-PR checkpoints.
- `srgical studio config`
  Shows or updates per-plan operate settings (`ssc` shortcut), including pause-for-PR behavior and reference guidance
  paths used during execution handoffs.
- `srgical run-next`
  Replays the generated execution handoff through the active agent, with `--plan <id>` for plan targeting,
  `--dry-run` for safe preview, `--agent <id>` for a one-run override, and `--auto` for bounded multi-step execution.

## Supported Agents

- `codex`
  Supported in the current launch slice for planning, pack writing, and `run-next` execution.
- `claude`
  Supported through the same adapter seam for planning, pack writing, and execution when the local Claude Code CLI is
  installed and available on `PATH`.
- `augment`
  Supported through the same adapter seam by targeting the local `auggie` binary for planning, pack writing, and
  execution when Augment CLI automation is available on the current machine.

If only one supported agent is installed, `srgical` can auto-select it for the workspace session. If more than one is
installed, you can keep the stored choice in the studio and still override a single execution with
`srgical run-next --agent <id>`.

## Design Direction

The product should feel closer to a creative control room than a grey enterprise shell:

- dark graphite base
- hot coral and amber accents
- crisp cyan status treatment
- large, cinematic panel framing
- transcript-first layout instead of command soup

The first TUI pass already leans in that direction, and we can keep pushing it.

## Distribution

The first production channels are GitHub Packages, the public npm registry, and GitHub Releases for downloadable
release assets. Version intent stays in git, and GitHub Actions bumps `package.json`, writes `CHANGELOG.md`, pushes
that release commit back to `main`, publishes the GitHub-scoped package, publishes the npm org package, and creates a
GitHub Release with the built tarballs attached.

For a local production-style packaging check:

```bash
npm run release:pack
```

The release bundle lands under `.artifacts/release/`. The broader distribution path, including standalone binaries and
wrapper package-manager installs, is documented in `docs/distribution.md`.

When that branch reaches `main`, the release workflow versions the package, publishes `@launcheleven/srgical` to
GitHub Packages, publishes `@launch11/srgical` to npm, and opens a matching GitHub Release entry with the packaged
artifacts.

The repo keeps a base version line in `package.json` and CI computes the next patch version from matching git tags. For
example, a base version of `0.0.0` means releases flow as `0.0.1`, `0.0.2`, and so on. To move to a new minor line,
change the base version to something like `0.1.0`.

## Install Prerequisites

Install `srgical`, then install at least one supported local agent CLI separately.

```bash
npm install
npm run build
node dist/index.js doctor
```

`doctor` is the source of truth for local availability. If an agent CLI is missing, `srgical` reports it as missing
instead of pretending it can run that path anyway.

The package publishes in two install channels:

- GitHub Packages: `@launcheleven/srgical`
- npm public registry: `@launch11/srgical`

For GitHub Packages installs, consumers need an `.npmrc` entry for `@launcheleven` plus a token before running:

```bash
npm install -g @launcheleven/srgical
```

For npm installs, consumers can use:

```bash
npm install -g @launch11/srgical
```

## Shell Completion

`bash` and PowerShell can now autocomplete existing plan ids from `.srgical/plans/` for commands such as
`srgical doctor`, `srgical studio`, `srgical ssp`, `srgical sso`, `srgical ssc`, and `--plan`.

During an interactive global install, `srgical` now attempts to add its managed completion block to the user's
`~/.bashrc` and PowerShell profile automatically. The commands below are still useful as a manual fallback or when
profile installation is disabled.

Load bash completion for the current session:

```bash
eval "$(srgical completion bash)"
```

Persist it in bash:

```bash
echo 'eval "$(srgical completion bash)"' >> ~/.bashrc
```

Load PowerShell completion for the current session:

```powershell
Invoke-Expression (& srgical completion powershell)
```

Persist it in PowerShell:

```powershell
Add-Content $PROFILE 'Invoke-Expression (& srgical completion powershell)'
```

## Getting Started

```bash
npm install
npm run build
node dist/index.js init --plan release-readiness
# or
node dist/index.js init release-readiness
node dist/index.js doctor --plan release-readiness
node dist/index.js studio plan --plan release-readiness
```

During development:

```bash
npm run dev -- studio
```

Typical flow once a workspace has a pack:

```bash
node dist/index.js --version
node dist/index.js about
node dist/index.js doctor --plan release-readiness
node dist/index.js changelog
node dist/index.js init --plan release-readiness
node dist/index.js studio plan --plan release-readiness
node dist/index.js studio config --plan release-readiness --pause-pr --set-reference docs/operate-guidelines.md
node dist/index.js studio operate --plan release-readiness
node dist/index.js run-next --plan release-readiness --dry-run
node dist/index.js run-next --plan release-readiness
node dist/index.js run-next --plan release-readiness --auto --max-steps 10
```

To override the active workspace agent for one execution only:

```bash
node dist/index.js run-next --plan release-readiness --agent codex
node dist/index.js run-next --plan release-readiness --agent claude
node dist/index.js run-next --plan release-readiness --agent augment
```

Inside both studio modes, the footer is intentionally minimal:

- `PgUp/PgDn` scrolls the transcript on Windows/Linux; on macOS use `Fn+Up` / `Fn+Down` (or `Ctrl+U` / `Ctrl+D` on all platforms)
- `/agents` shows support and current selection
- `/agents <id>` (or `/agent <id>`) switches the current tool
- `/clear` hides the current transcript view without deleting planning history
- `/history` restores the hidden transcript history after `/clear`
- `/help` shows the full command set
- `/quit` exits the studio

Mode-specific guard rails:

- `studio plan` focuses planning (`/read`, `/readiness`, `/advice`, `/write`, `/dice`, `/review`, `/confirm-plan`) and blocks execution commands
- `studio plan` also includes plan-interrogation commands (`/assess`, `/gather`, `/gaps`, `/ready`) for iterative clarity checks
- `studio operate` focuses execution (`/go`, `/preview`, `/run`, `/auto`, `/stop`, `/unblock`) and blocks planning conversation/write commands
- `studio operate` auto-runs `/go` on boot using the active plan's operate config

The composer is now multiline with an expanded six-line visible input area. `Enter` sends, while `Shift+Enter`,
`Alt+Enter`, or `Ctrl+J` inserts a newline when the terminal exposes those keys distinctly.
For faster editing, `Ctrl+W`, `Alt/Option+Backspace`, and `Ctrl+Backspace` (when exposed by the terminal) delete the
previous word in the composer.
`Up` and `Down` cycle previously submitted slash commands.

Large context dumps can be pasted directly with no delimiter syntax. Studio automatically keeps rapid paste bursts as
new lines so big blocks land cleanly in the composer.

`Tab` and `Shift+Tab` now cycle file-path completions for `/read`, `/open`, `/workspace`, and existing `/plan` ids.
Native terminal drag-selection is left enabled in studio so transcript/output text can be highlighted directly in the terminal.
`/copy`, `/copy visible`, `/copy all`, and `/copy last` send transcript text to the OS clipboard when terminal selection is awkward.
When using `/read`, any trailing text after the path is auto-submitted as the next user prompt once file context is loaded.
If the path is omitted, `/read` loads every file in the current directory (non-recursive).
When using `/workspace`, trailing text after the path is auto-submitted after a successful switch.
When using `/open`, trailing text after the target is ignored with a hint so path parsing stays predictable.

In `studio operate`, `/go` runs the configured execution loop:

- when pause-for-PR is disabled, `/go` runs auto mode toward completion
- when pause-for-PR is enabled, `/go` runs one step and pauses so you can open a PR before continuing
- when auto mode stops because the next step is blocked, use `/unblock` (or `/unblock <STEP_ID>`) to move it back to `pending`, then `/go` again
- use `/unblock analyze [focus]` if you want advisory root-cause analysis before retrying

Planner replies, `/write`, and `/run` now stream model output into the transcript while the underlying CLI tool is
still running, with the transcript revealing text progressively instead of waiting for one final blob.

`studio plan` can also ask the active agent for an AI assessment of the current planning state. Run `/advice` to cache a
plain-English summary of:

- the problem statement the agent believes you are solving,
- whether the current plan state is clear or still fuzzy,
- what research or repo truth still needs to be gathered,
- and the best next move right now.

Before execution, the current draft should be reviewed and confirmed:

- use `/review` to get the checklist and file targets
- use `/open all` to open the planning docs in VS Code
- use `/confirm-plan` to approve the current written or sliced draft as the execution baseline

## Current Claude Caveat

Claude support is real, but it is not treated as interchangeable with Codex. The current non-interactive Claude path
uses `plan` mode for planner replies and `acceptEdits` with allowlisted local tools for pack-writing and execution.

If the Claude CLI is not installed locally, `doctor`, the studio, and `run-next --agent claude` all report that
honestly instead of falling back to a fake Claude path.

## Current Augment Caveat

Augment support is wired to the documented `auggie` automation flags: `--print`, `--quiet`, `--instruction-file`,
`--workspace-root`, `--rules`, `--allow-indexing`, `--wait-for-indexing`, `--max-turns`, and `--ask` for planner-only
runs.

The defaults deliberately force workspace indexing and append srgical-specific Augment rules so the agent stays biased
toward incremental planning, validated execution, and clear next-step handoffs. Session history is also left on so
workspace iterations can accumulate inside Auggie instead of being treated as throwaway runs.

That means successful Augment execution still depends on a real Augment CLI install, an authenticated session such as
`auggie login` or `AUGMENT_SESSION_AUTH`, and whatever automation entitlements or local permission policies your
account requires.

## Planned Next Steps

- deepen the studio experience without weakening the terminal-first workflow
- keep multi-agent docs and validation honest as Claude and Augment runtime behavior get more live coverage
- expand release outputs from npm tarballs into standalone binaries and wrapper package-manager installers
