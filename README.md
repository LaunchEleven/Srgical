# srgical

`srgical` is a local-first CLI for planning work with an AI, turning that plan into a visible pack inside your repo, and then executing the next step cleanly.

It is built around a simple loop:

1. `prepare` the plan
2. approve it
3. `operate` the next step
4. repeat

## Install From npm

Requirements:

- Node.js 20 or newer
- Codex authentication from `codex login` or `CODEX_API_KEY`, or Claude authentication through a Console API key or supported cloud provider
- A working `claude` or `auggie` CLI is optional and remains available as a compatibility fallback

```bash
npm install -g @launch11/srgical
```

After install:

```bash
srgical
```

Running `srgical` opens the browser-first Studio for the current Git repository. Pass another repository path directly, or use **Switch repository** in the Studio to choose from recent repositories. Without a global install, use `npx @launch11/srgical`.

Chrome and other compatible browsers can install the local Studio as a standalone app from the **Install app** action. Srgical uses stable local origin `http://127.0.0.1:43111` by default so the installed app can reconnect on later runs. The local `srgical` process still provides the repository and agent backend while the app is open; set `SRGICAL_STUDIO_PORT` or pass `--port` if that port is unavailable.

## Quick Start

Create or reopen a named plan:

```bash
srgical prepare release-readiness
```

Add `--web` for the conversation-first local Studio:

```bash
srgical prepare release-readiness --web
```

The Studio keeps worktrees, conversations, provider activity, approvals, questions, plan state, and skills in one window. Once it is open, the default entry point is simply **What do you want to work on?**—no plan name, mode, branch, or worktree decision is required for each new conversation.

## Native Codex and Claude providers

The native Codex provider uses the official `@openai/codex-sdk` and its pinned CLI runtime. It reuses `codex login` authentication or `CODEX_API_KEY`, keeps resumable Codex thread IDs, streams structured tool/file/MCP/usage events, and applies read-only or workspace-write sandboxing from the conversation's permission mode.

The native Claude provider uses `@anthropic-ai/claude-agent-sdk` and activates when one of these supported authentication paths is configured:

- `ANTHROPIC_API_KEY`
- `CLAUDE_CODE_USE_BEDROCK=1`
- `CLAUDE_CODE_USE_VERTEX=1`
- `CLAUDE_CODE_USE_FOUNDRY=1`

Srgical deliberately does not reuse Claude subscription OAuth or browser credentials. If supported native authentication is unavailable, Studio explains why and uses the selected local CLI adapter.

Both native providers support durable sessions, resume, streaming, tool progress, tasks, interrupt, usage events, skills, and MCP servers. Claude additionally exposes provider-native session forks, interactive permission and question requests, rate-limit events, live MCP connection status, and file checkpoints. Codex worktree promotion starts a new thread with the preserved Srgical transcript and plan context because the TypeScript SDK does not currently expose thread forking.

### Provider and billing path

Open **Settings** from the repository home or the conversation inspector to choose the authentication route used by new conversations. Studio detects each route independently, enables only configured routes, and stores the preference without storing secrets.

Supported routes are:

- Codex through a ChatGPT subscription login
- Codex through `CODEX_API_KEY` or `OPENAI_API_KEY`
- Claude through `ANTHROPIC_API_KEY`
- Claude through Amazon Bedrock, Google Vertex AI, or Microsoft Foundry

Existing conversations keep the provider and authentication route they started with. When a route is selected, Srgical removes competing provider credentials from that provider's child-process environment so a subscription conversation cannot silently switch to API-key billing. Claude subscription OAuth is not exposed through the native Claude Agent SDK and is therefore not offered as a native route.

## Sessions

A session is the durable unit of conversation; a worktree is a workspace the session may use for a period of time. They intentionally are not one-to-one. New conversations start against protected repository context with planning permissions, unless **Start in a worktree** is selected. When a discussion becomes implementation work, **Create worktree** carries its provider context where supported, transcript, plan artifacts, connectors, and effective tools into an isolated branch and worktree.

Studio provides a repository-wide session library with search, recency groups, pinned and archived views, message previews, fork ancestry, and current or retired workspace context. Repository conversations and worktree conversations can both be reopened from the same history.

Use **Finish Work** on a lane for post-operation cleanup. Studio assesses active operations, dirty/conflicted files, divergence, locks, and primary-checkout safety before acting. Finishing archives the lane's sessions and records their terminal commit and workspace summary. Worktree removal remains separately gated and requires the lane ID as typed confirmation; the branch, transcripts, plan artifacts, and binding history are retained.

## Worktrees and skills

Each lane maps one worktree and branch to one plan, a set of durable sessions, and an effective skill set. Studio reports dirty/conflict counts, ahead/behind state, stale or prunable worktrees, locks, and a recommended safe next action.

The browser Studio also turns live Git diagnostics into safe prompt tools. **Inspect conflicts** explains every unmerged path without changing Git state, **Resolve conflicts** is enabled only in an isolated conflicted worktree, **Update from base** performs a merge-oriented update without history rewriting, and **Integration check** reviews readiness before a lane is combined. These are agent prompts with explicit safety boundaries—not hidden shell scripts—and they never commit, push, reset, abort, or remove a worktree automatically.

The global skills directory is created automatically at `~/.srgical/skills`. Studio also discovers:

- `.srgical/skills`
- `.claude/skills` and `~/.claude/skills`
- `.codex/skills` and `~/.codex/skills`
- `.agents/skills`
- `skills`
- additional directories configured in the Skills inspector

Skills are hashed with their supporting files and tracked by source, scope, trust, compatibility, precedence, and conflicts. They can be enabled, disabled, trusted, reviewed, or blocked per repository.

Effective skills can also become custom buttons. In Studio **Settings → Prompt buttons**, choose a skill, give the button a short label, and define the task prompt. The resulting action appears beside the chat composer, resolves the current effective skill at click time, and asks the agent to read its complete `SKILL.md` before acting. Button configuration is repository-scoped under `~/.srgical/repos/<repo-id>/skills.json`; blocked or disabled skills make their buttons unavailable.

## Connectors and MCP servers

Studio Settings includes guided connection cards for GitHub, Linear, Slack, Notion, and Google Drive. **Connect** opens a service-specific walkthrough, hands off to the official setup page, and clearly separates hosted OAuth from token or OAuth-client configuration. Installing a hosted connector adds its official MCP endpoint to the repository; its secure consent flow opens when the selected native Codex or Claude provider first connects. The advanced **MCP** inspector also supports custom Streamable HTTP, SSE, and local stdio servers. Existing Claude-style JSON can be imported directly:

```json
{
  "mcpServers": {
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp"
    },
    "local-tools": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"]
    }
  }
}
```

Connector definitions are repository-scoped but live under `~/.srgical/repos/<repo-id>/connectors.json`, outside Git worktrees. Use `${ENV_VAR}` placeholders for tokens, headers, process environment values, and OAuth client credentials so secrets do not need to be written to that file. Studio reports missing variables before a turn, then shows the provider's live connection state and discovered tools while the turn is active.

Remote OAuth behavior depends on the MCP server and provider. Claude receives compatible OAuth client metadata; Codex uses its normal MCP OAuth credential store and callback configuration. Linear supports dynamic registration, Slack requires workspace approval, and Google's Drive MCP is currently a Developer Preview and requires a configured Google OAuth client. Connector changes take effect on the next native provider turn. Claude's normal user/project/local settings sources, including compatible `.mcp.json` configuration, and Codex's normal `config.toml` MCP sources remain enabled alongside Srgical-managed connectors.

That command creates the plan pack under `.srgical/plans/release-readiness/` if it does not exist, then opens the full-screen prepare studio.

Inside `prepare`:

- Type normal text to talk to the planner
- Press `F2` to gather more context
- Use `:import <path>` to read a specific document and sync it into `context.md`
- Use `:context` to refresh `context.md` from the current transcript and gathered evidence
- Press `F3` to build the draft
- Press `F4` to slice the plan into steps
- Press `F6` to approve the current draft
- Type `:help` to see the command list

Check the current state at any time:

```bash
srgical status release-readiness
```

When the plan is approved, switch to execution:

```bash
srgical operate release-readiness
```

Useful operate variants:

```bash
srgical operate release-readiness --dry-run
srgical operate release-readiness --auto --max-steps 5
srgical operate release-readiness --checkpoint
```

## Main Commands

```bash
srgical prepare <id>
srgical operate <id>
srgical status [id]
srgical about
srgical changelog
srgical completion bash
srgical completion powershell
```

## What Gets Written

Visible plan artifacts remain in `.srgical/` inside your repo. Durable sessions and skill preferences live under `~/.srgical/`; the worktree registry lives in shared Git metadata so branch changes cannot rewrite management state.

Inside prepare, `context.md` is treated as a living document. Gather/import actions can refresh it directly before you build the full draft.

## Notes

- Legacy commands such as `doctor`, `init`, `studio`, and `run-next` now exist only to point you to the rebooted workflow.
- If you want a fuller walkthrough of the prepare experience, see [docs/studio-plan-tutorial.md](docs/studio-plan-tutorial.md).

## Development

```bash
npm install
npm run build
npm test
npm run dev -- prepare release-readiness
```
