# Connectors and MCP configuration

Srgical treats external access as repository-scoped configuration rather than worktree content. The Studio MCP inspector writes definitions to:

```text
~/.srgical/repos/<repository-id>/connectors.json
```

That location keeps a branch or untrusted checkout from silently enabling a connector. Enabling a connector makes it available to the next native Codex SDK or Claude Agent SDK turn in every lane for that repository.

## Supported configuration

- Streamable HTTP (`type: "http"`)
- SSE (`type: "sse"`)
- Local process/stdio (`command` plus optional `args` and `env`)
- Request headers
- OAuth client metadata
- Per-server timeout and always-load behavior
- Claude-style `{ "mcpServers": { ... } }` JSON import

The built-in catalog currently includes Linear, Slack, and Google Drive using their official hosted endpoints. The catalog is only a convenience layer; any compatible MCP can be added through the custom form or JSON import.

## Secrets and environment references

Configuration strings may refer to environment variables with `${NAME}`. References work in URLs, commands, arguments, headers, process environment values, and OAuth client fields. For example:

```json
{
  "mcpServers": {
    "private-service": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${PRIVATE_MCP_TOKEN}"
      }
    }
  }
}
```

Srgical resolves the value only when starting an agent turn. The resolved secret is passed in memory to the provider and is not written back to the registry. Missing variables block only that connector and are shown in the inspector; other ready connectors still load.

The registry file can also hold literal values for compatibility with existing MCP configuration. Prefer environment references for credentials and keep the user profile containing `~/.srgical` appropriately protected.

## OAuth and connection lifecycle

Some remote MCP servers use dynamic OAuth registration, while others require a fixed client ID or client secret. Srgical passes supported OAuth metadata to Claude's MCP client. Codex uses its normal MCP OAuth credential store and Srgical projects compatible callback configuration into that turn. The server or provider may open a browser on first use. Workspace or organization administrators may still need to approve the integration.

The inspector has two status phases:

1. Before a turn, `ready`, `disabled`, or `missing environment` describes local configuration readiness.
2. During a native Claude turn, Claude reports `connected`, `pending`, `needs auth`, `failed`, or `disabled`, together with discovered tools and their safety annotations. During a Codex turn, Studio reports MCP calls through the shared tool activity stream; the Codex TypeScript SDK does not currently expose the same preflight server-status API.

Connector edits are deliberately applied at the next turn boundary. This avoids changing the external tool surface in the middle of a model response. Claude's user, project, and local settings sources remain enabled, so existing compatible `.mcp.json` files continue to work alongside the Srgical registry. Codex continues to load its normal `config.toml` sources; Srgical's repository-scoped definitions are added as per-turn overrides.

## Provider behavior

The structured MCP integration is available through both native providers. Claude supports Streamable HTTP, SSE, stdio, OAuth metadata, reconnect, and live server/tool status. Codex supports Streamable HTTP and stdio through official CLI configuration, maps MCP calls into Studio events, and keeps resolved header values in the child-process environment instead of CLI arguments. Legacy CLI fallbacks may load their own MCP configuration, but Srgical cannot report their connection state or tool catalog in Studio. Configurations remain saved when a native provider is unavailable and become active when native authentication is restored.
