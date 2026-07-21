# Conversation hooks

Hooks extend the Srgical conversation lifecycle without forcing every task through a planning workflow. They are repository-scoped and stored outside the checkout at:

```text
~/.srgical/repos/<repository-id>/hooks.json
```

Open the **Hooks** inspector in a conversation to create, test, order, enable, disable, or remove hooks.

## Lifecycle

The first supported triggers are:

- `turn.received`: contributes context or policy before the agent answers.
- `turn.completed`: runs after the primary task and before the agent finalizes its response.

Both triggers are part of the same agent turn. Hook execution is represented by durable `hook.started`, `hook.completed`, and `hook.failed` events and appears as activity in the transcript.

## Handlers

### Effective skill

A skill hook resolves the effective trusted skill at the start of every turn and asks the agent to read its complete `SKILL.md`. If the skill becomes disabled, blocked, shadowed, or incompatible, the hook fails instead of silently using stale instructions.

### MCP tool

An MCP hook resolves an enabled connector and named tool. MCP hooks require a native provider with connector support. When a connector has reported its tool catalog, Srgical validates the configured tool name before starting the turn.

The Hooks inspector includes **Graph retrieval** and **Graph capture** quick starts. These are schema-neutral: choose the knowledge-graph connector and its query or mutation tool, then tailor the instruction to the graph's ontology.

## Failure policy

Observational hooks report failure in the transcript and allow the turn to continue. Blocking hooks stop the turn if their skill, connector, environment, or tool is unavailable. Priorities run from lower numbers to higher numbers.

Hooks never store connector secrets. MCP authentication and environment references continue to use the connector registry.
