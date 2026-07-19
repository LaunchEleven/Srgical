# Native Studio Implementation Plan

## Objective

Turn srgical into a conversation-first, local coding studio with durable agent sessions, structured tool and permission UX, first-class worktree lanes, and a unified skills registry. Anthropic access must use supported product authentication: Claude Console API credentials, Workload Identity Federation, or a supported cloud provider. The product must not offer Claude subscription OAuth.

## Product invariants

- Local-first: repository content and execution stay on the user's machine unless a configured provider requires remote inference.
- One lane is one isolated worktree and branch associated with a plan and effective skill set; sessions bind to lanes over time and retain that binding history after cleanup.
- Provider output is preserved as structured events; stdout is never the canonical conversation model.
- Human approval is explicit for destructive or policy-sensitive operations.
- Management state is outside branch-controlled files; plan artifacts remain repository-visible Markdown.
- Provider-specific configuration is discovered and indexed, not silently copied or rewritten.
- Every migration is backward compatible with existing `.srgical/plans` content.

## Target package boundaries

### `@srgical/studio-shared`

Provider-neutral DTOs and schemas only: session, event, permission, lane, skill, and API contracts. It must not import CLI implementation files.

### `@srgical/agent-runtime`

Owns `AgentProvider`, `AgentSession`, normalized events, persistence, provider capability detection, and adapters. Initial adapters:

- `legacy-cli` compatibility adapters for Codex, Claude, and Augment.
- `anthropic-agent-sdk` using supported API or cloud-provider authentication.

### `@srgical/repo-runtime`

Owns Git discovery, worktree reconciliation, repository identity, lane lifecycle, diff/status summaries, process ownership, and safe cleanup.

### `@srgical/skill-registry`

Owns skill discovery, frontmatter parsing, scope, trust, precedence, compatibility, hashing, activation, and provider projection.

### `@srgical/studio-core`

Application orchestration. It consumes the three runtimes through interfaces and exposes snapshots/events to UI hosts. It must not reach into `apps/cli/src`.

### `apps/cli` and `apps/studio-web`

Thin delivery surfaces. The CLI hosts the local service; the web app renders state and sends commands.

## Canonical data contracts

### Session

`AgentSessionRecord` contains:

- stable srgical session ID;
- provider ID and provider session ID;
- repository ID, lane ID, worktree path, plan ID;
- title, model, permission mode and lifecycle status;
- pin/archive/tombstone state, fork ancestry, last-message preview, and ordered workspace-binding history;
- created/updated timestamps and last event sequence;
- effective skill hashes and provider capabilities.

### Events

Every event has `eventId`, `sequence`, `timestamp`, `sessionId`, and optional provider payload. Required normalized event kinds:

- `session.started`, `session.status`, `session.completed`, `session.failed`;
- `message.started`, `message.delta`, `message.completed`;
- `tool.started`, `tool.progress`, `tool.completed`, `tool.failed`;
- `permission.requested`, `permission.resolved`;
- `question.requested`, `question.resolved`;
- `task.started`, `task.progress`, `task.completed`;
- `files.changed`, `usage.updated`, `rate_limit.updated`;
- `checkpoint.created`, `checkpoint.rewound`, `workspace.retired`.

Events are appended to JSONL and projected into UI snapshots. Provider-specific fields remain available for debugging but are not required by React components.

### Commands

The UI sends typed commands: create/resume/fork/rename session, send/steer/interrupt, resolve permission, answer question, change model/mode, rewind, and manage skills or lanes. Commands are idempotent where practical and include a client request ID.

## Storage topology

Global state lives under `~/.srgical/`:

```text
~/.srgical/
  settings.json
  skills/<skill-id>/SKILL.md
  repos/<repo-id>/
    repo.json
    lanes.json
    sessions/<session-id>/session.json
    sessions/<session-id>/events.jsonl
```

Repository-visible planning content remains under `.srgical/plans/<plan-id>/`. Repository identity is derived from the Git common directory plus remote identity and is resilient to moving the checkout.

## Delivery milestones

### M0 — Green baseline

- Correct ignore patterns and stale workspace installation.
- Make `npm run build` and `npm test` green from a clean install.
- Add contract tests for package boundaries.

Exit: clean install, build, and all existing tests pass.

### M1 — Structured session kernel

- Add provider-neutral contracts to `studio-shared`.
- Implement JSONL event store and session repository.
- Wrap legacy adapters so they emit normalized text/status events.
- Add interrupt support and persist lane-to-session identity.
- Add replay and recovery tests.

Exit: a CLI-backed conversation survives a process restart and replays identically.

### M2 — Anthropic Agent SDK provider

- Add the TypeScript SDK as an optional provider dependency.
- Detect only supported authentication sources without reading raw credentials.
- Stream partial messages, tools, tasks, usage, auth status and rate limits.
- Implement resume/fork, `canUseTool`, questions, interrupt, permission-mode changes and checkpoints.
- Add fixture-driven adapter tests that require no live Anthropic account.

Exit: mocked end-to-end sessions exercise every interactive event; an opt-in live smoke test works with Console/cloud authentication.

### M3 — Conversation-first shell

- Replace separate lane browser tabs with route-based lane/session switching.
- Add repository/lane/session rail, structured transcript, inspector and composer.
- Render tools, diffs, tasks, approvals, questions, errors and usage progressively.
- Add stop, steer, retry, resume, fork, rename and rewind controls.
- Preserve keyboard-first operation and responsive layouts.

Exit: all session operations are available without terminal commands or additional browser tabs.

### M4 — Intelligent lanes

- Move lane registry to global repository state and migrate v1 records.
- Reconcile managed and discovered worktrees on every refresh.
- Compute base ref, merge base, ahead/behind, dirty counts, conflicts, locked/prunable state and active session ownership.
- Support adopt, repair, archive, safe remove, merge/rebase guidance and open-in-editor.
- Require an explicit typed confirmation for destructive dirty-worktree removal.

Exit: every Git worktree has an explainable lifecycle state and safe next actions.

### M4.1 — Session library and post-operation lifecycle

- Treat sessions as repository-level durable objects rather than lane-local tabs.
- Add search, recency grouping, pin/archive filters, previews, ancestry and cross-worktree opening.
- Model session-to-worktree bindings as history so a retired workspace never destroys conversation identity.
- Add **Finish Work** assessment with separate gates for session archival and worktree removal.
- Persist the terminal commit and cleanup diagnostics before retiring bindings; retain branches, transcripts and plan artifacts.

Exit: users can find and resume any session, fork a retired session into a new worktree, and safely close completed work without losing history.

### M5 — Unified skills

- Create `~/.srgical/skills` automatically.
- Discover canonical global/project skills and configured provider directories.
- Parse Agent Skills frontmatter and supporting files lazily.
- Track scope, source, trust, hash, compatibility and conflicts.
- Compute an effective skill set per lane/session and project it into provider configuration.
- Provide browse, enable/disable, inspect, trust and conflict-resolution UI.

Exit: the UI explains exactly which skills are active, why, and from which source.

### M6 — Hardening and distribution

- Threat-model local tokens, renderer boundaries, executable skills and worktree deletion.
- Add schema migrations, crash recovery, telemetry opt-in, accessibility and performance budgets.
- Add Windows/macOS/Linux packaging and upgrade tests.
- Document authentication, migration, backup and recovery.

Exit: release candidate passes clean-machine and interrupted-operation scenarios on all platforms.

## Test strategy

- Unit: parsers, reducers, precedence, Git porcelain, provider event mapping.
- Contract: every provider must pass the same session lifecycle suite.
- Integration: local service commands/events, persistence recovery, worktree reconciliation.
- UI: transcript rendering, approvals, questions, lane switching, keyboard navigation.
- Destructive safety: dirty/untracked/conflicted worktrees, symlinked skills, malformed manifests.
- Live tests are opt-in and never required by CI.

## Migration rules

- Import the current worktree registry once, retaining timestamps and locks.
- Keep current planning session messages as a legacy transcript event stream.
- Keep legacy CLI providers available until structured providers cover equivalent workflows.
- Never delete old state during migration; write a versioned backup and mark successful completion.

## Immediate execution order

1. Complete M0.
2. Land shared session/event contracts and their tests.
3. Implement storage and a legacy provider bridge.
4. Route the existing controller through the session kernel.
5. Add the Anthropic SDK adapter.
6. Redesign React against the stable event model.
7. Migrate worktrees and implement skills after the conversation kernel is proven.

## Implementation status (2026-07-19)

The first vertical slice is implemented and validated:

- M0: green build/test baseline and corrected workspace/package resolution.
- M1: provider-neutral events, JSONL session persistence, recovery/replay, legacy bridge, and lane-to-session identity.
- M2: Anthropic Agent SDK adapter with supported-auth detection, structured streams, tools, tasks, permissions, questions, usage, rate limits, resume/fork, interrupt, and rewind; fixture tests require no account.
- M3 vertical slice: one-window worktree switching, repository-wide searchable session library, recency and lifecycle filters, pin/archive/tombstone actions, ancestry-aware fork, structured activity, inline decisions, responsive composer, and worktree/skills/plan inspector.
- M4 vertical slice: registry migration to shared Git metadata, discovered/stale worktree reconciliation, divergence and dirty/conflict diagnostics, lifecycle guidance, and typed removal confirmation.
- M4.1: durable session/workspace binding history and a **Finish Work** flow that independently gates archival and worktree removal, records terminal cleanup diagnostics, and preserves branches and transcripts.
- M5 vertical slice: automatic global directory, multi-shape discovery, frontmatter parsing, supporting-file hashes, per-repository directories/overrides, precedence/conflicts, trust, enablement, and inspector controls.

Validation includes the full production build, the automated suite (including a real temporary-repository Finish Work integration test), a token-protected local HTTP smoke test, and a production dependency audit.

Remaining release work is intentionally not represented as complete: extracting all Git code into `@srgical/repo-runtime`, removing the remaining `studio-core` imports from `apps/cli`, live opt-in provider tests, multi-platform packaging, accessibility automation, and interrupted-upgrade/migration tests.
