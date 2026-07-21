# ADR 0002: Browser-only product surface

## Status

Accepted on 2026-07-21

## Decision

Srgical has one interactive product surface: the browser Studio. The npm `srgical` executable remains as a thin local launcher and backend host, with an optional working-directory argument and network-host options. It does not expose planning, execution, status, shell-completion, or terminal-renderer workflows.

The React application owns conversations, model selection, planning tools, worktree actions, skills, hooks, connectors, and settings. Provider and filesystem operations remain local Node services behind that UI.

## Why

- One interaction model is easier to learn, test, and maintain.
- Browser UI patterns carry naturally into an installed PWA or future desktop shell.
- Model, connector, permission, parallel-work, and hook state benefit from persistent visual context.
- A thin local launcher preserves local filesystem and agent access without making the terminal a second product.

## Consequences

- `srgical [working-directory]` is the supported entry point.
- Former terminal commands fail with concise migration guidance.
- Shell-profile completion installation and the `blessed` renderer are removed.
- Non-interactive diagnostics should become browser views or backend health endpoints when needed.
