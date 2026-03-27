# srgical

`srgical` is a local-first orchestration CLI for the workflow you have already been using manually:

1. talk to an AI until the plan is sharp,
2. write a four-file planning pack into the repo,
3. repeatedly execute the next eligible step,
4. force validation and handoff updates every time.

The current launch slice supports both local `codex` and local `claude` CLI installs through the same `.srgical/`
workflow. `srgical` detects which supported tools are actually installed, keeps the planning pack agent-neutral, and
lets you choose the active agent for the current workspace session.

## Why This Exists

The reference system in `G:\code\Launch11Projects\Writr\migrations-part-5` is strong because it does not just create a
plan. It creates momentum:

- a stable architecture file,
- a current-context handoff log,
- a step-by-step tracker,
- and a repeatable next-agent prompt that keeps execution disciplined.

`srgical` turns that from a repeated copy-paste ritual into a product.

## Current Slice

This repo currently ships the foundation for:

- `srgical doctor`
  Reports whether the current workspace has a planning pack, which supported agent is active, and which supported
  agents are available locally.
- `srgical init`
  Creates a local `.srgical/` planning pack from built-in templates.
- `srgical studio`
  Opens a full-screen planning studio where you can plan against the repo, inspect supported tools with `/agents`,
  switch the session agent with `/agent <id>`, and explicitly trigger pack writes or execution.
- `srgical run-next`
  Replays the generated next-agent prompt through the active agent, with `--dry-run` for safe preview and
  `--agent <id>` for a one-run override that does not change the stored workspace choice.

## Supported Agents

- `codex`
  Supported in the current launch slice for planning, pack writing, and `run-next` execution.
- `claude`
  Supported through the same adapter seam for planning, pack writing, and execution when the local Claude Code CLI is
  installed and available on `PATH`.

If only one supported agent is installed, `srgical` can auto-select it for the workspace session. If both are
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

## Getting Started

```bash
npm install
npm run build
node dist/index.js doctor
node dist/index.js studio
```

During development:

```bash
npm run dev -- studio
```

Typical flow once a workspace has a pack:

```bash
node dist/index.js doctor
node dist/index.js run-next --dry-run
node dist/index.js run-next
```

To override the active workspace agent for one execution only:

```bash
node dist/index.js run-next --agent codex
node dist/index.js run-next --agent claude
```

## Current Claude Caveat

Claude support is real, but it is not treated as interchangeable with Codex. The current non-interactive Claude path
uses `plan` mode for planner replies and `acceptEdits` with allowlisted local tools for pack-writing and execution.

If the Claude CLI is not installed locally, `doctor`, the studio, and `run-next --agent claude` all report that
honestly instead of falling back to a fake Claude path.

## Planned Next Steps

- deepen the studio experience without weakening the terminal-first workflow
- keep dual-agent docs and validation honest as Claude runtime behavior gets more live coverage
- expand release outputs from npm tarballs into standalone binaries and wrapper package-manager installers
