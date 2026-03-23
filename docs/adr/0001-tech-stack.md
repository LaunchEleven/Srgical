# ADR 0001: Initial Stack

## Status

Accepted on 2026-03-23

## Decision

The first implementation uses TypeScript on Node with:

- `commander` for the CLI surface
- `blessed` for the full-screen terminal UI
- native child-process spawning for Codex orchestration

## Why

- Node is already available in the current environment
- the product needs fast iteration on terminal UX, subprocess orchestration, and text-heavy state
- packaging through `npm` is immediate, while other install paths can wrap release artifacts later
- the first version needs to target a real installed agent today, and `codex` is already present

## Consequences

- The first release is easiest to distribute through `npm`
- Homebrew, Chocolatey, and PyPI support should be treated as release-packaging work, not as a reason to block the
  initial product
- if we later want a single native binary without Node, we can revisit Go or .NET once the workflow is proven
