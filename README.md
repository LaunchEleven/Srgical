# srgical

`srgical` is a browser-first local workspace for AI-assisted software work. It keeps conversations, working directories, worktrees, models, skills, hooks, connectors, planning tools, and provider activity in one UI.

The npm executable is intentionally thin: it starts the local backend and opens Studio. Planning and execution are browser workflows; there is no separate terminal UI to learn or maintain.

## Install and run

Requirements:

- Node.js 20 or newer
- Codex authentication from `codex login` or `CODEX_API_KEY`, or Claude authentication through a Console API key or supported cloud provider

```bash
npm install -g @launch11/srgical
srgical
```

Pass a repository or any working directory when useful:

```bash
srgical ./my-project
```

Without a global install, run `npx @launch11/srgical`. Studio reopens the last working directory by default and provides a clickable picker for recent folders and arbitrary paths. The selected folder becomes the session's working directory; Git-only controls appear when that folder is a repository.

Chrome and other compatible browsers can install Studio as a standalone app. The local `srgical` process still provides filesystem, Git, connector, and agent access while the app is open. Studio uses `http://127.0.0.1:43111` by default; pass `--port` or set `SRGICAL_STUDIO_PORT` to change it, and use `--no-open` when another app window will connect.

## Conversations and models

Start work from **What do you want to work on?**. A new conversation does not require a plan, mode, branch, or worktree decision.

Each conversation has a model selector in its header. Studio asks the authenticated provider for the models that are actually available, shows the provider-managed default, and persists an explicit choice with that conversation. Changing the model affects the next turn and does not change other conversations.

The native Codex provider uses `@openai/codex-sdk`, reuses `codex login` or API-key authentication, and discovers its selectable models from the bundled Codex runtime. The native Claude provider uses `@anthropic-ai/claude-agent-sdk` and its account-aware supported-model list. Claude supports:

- `ANTHROPIC_API_KEY`
- `CLAUDE_CODE_USE_BEDROCK=1`
- `CLAUDE_CODE_USE_VERTEX=1`
- `CLAUDE_CODE_USE_FOUNDRY=1`

Open **Settings** to select the authentication and billing route used by new conversations. Existing conversations retain the provider, authentication route, and model they started with. Srgical does not store provider secrets.

## Working directories, repositories, and worktrees

A plain folder is directly writable and hides Git-only controls. In a Git repository, a new repository conversation starts against the protected primary checkout. Use **Create worktree** when a discussion becomes implementation work; Studio carries the transcript, provider context where supported, plan artifacts, connectors, hooks, and effective skills into an isolated worktree.

The session library supports search, recency groups, pinning, archiving, forks, message previews, and current or retired workspace context. **Finish Work** assesses active operations, dirty or conflicted files, divergence, locks, and checkout safety before archival or optional worktree removal.

Built-in worktree actions turn live Git diagnostics into bounded prompts:

- **Inspect conflicts** explains unmerged paths without changing Git state.
- **Resolve conflicts** is available only in an isolated conflicted worktree.
- **Update from base** uses merge-oriented integration without rewriting history.
- **Integration check** reviews readiness before work is combined.

These actions do not silently commit, push, reset, abort, or remove worktrees.

## Skills, prompt buttons, and hooks

Studio discovers skills from Srgical, Claude, Codex, Agents, repository, global, and user-configured skill directories. Type `/` in the composer to search effective skills, select one with the keyboard, and activate its complete `SKILL.md` for the turn.

In **Settings → Prompt buttons**, bind an effective skill to a short reusable prompt. The button appears beside the composer and resolves the current version of the skill when clicked.

The **Hooks** inspector can automatically activate a skill or named MCP tool before an answer or before the final response. Hooks are ordered, may be blocking or observational, and emit visible lifecycle activity into the conversation. See [Conversation hooks](docs/hooks.md).

## Connectors and MCP

Settings includes guided connection cards for GitHub, Linear, Slack, Notion, and Google Drive. **Connect** opens the service-specific authorization flow. Advanced configuration supports custom Streamable HTTP, SSE, and local stdio MCP servers, plus import of Claude-style MCP JSON.

Connector definitions are repository-scoped and stored outside worktrees under `~/.srgical/repos/<repo-id>/connectors.json`. Use `${ENV_VAR}` placeholders for secrets. Studio validates required variables and displays live provider connection and tool status during turns. See [Connectors and MCP](docs/connectors-and-mcp.md).

## Planning when it helps

Planning is an optional set of tools inside the conversation, not a separate product mode. Use the planning inspector to gather evidence, maintain `context.md`, build or slice a visible plan, approve it, and run steps when the work benefits from that structure. Ordinary chat, skills, hooks, connectors, and model selection remain available throughout.

Visible planning artifacts live under `.srgical/` in the working repository. Durable sessions and repository-scoped preferences live under `~/.srgical/`.

## Development

```bash
npm install
npm run build
npm test
npm run dev -- .
```
