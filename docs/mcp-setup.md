# Developer MCP setup (optional)

MCP servers here are **developer tools** for working on this repo in an editor such as Cursor. The
product does not depend on them, and they never receive end-user tokens.

## Rules

- Never give a developer MCP: the product's `COMPOSIO_API_KEY`, Composio session MCP URLs or
  headers, end-user OAuth tokens, `BETTER_AUTH_SECRET`, database URLs or the E2B key.
- Pass each MCP only the single variable it needs, via the editor's per-server `env`, never by
  inheriting your whole shell or `.env`.
- Keep MCP config with credentials out of Git. `.cursor/mcp.json` with secrets should be user-level,
  not committed.

## Useful servers

| Server | Why | Credentials |
|---|---|---|
| Playwright MCP (`@playwright/mcp`, pin a version ≥ 7 days old) | Drive the local web app at `http://localhost:3000` while developing | none; sign in with the dev seed user |
| Temporal docs / your own read-only tooling | Look up SDK behaviour | none |

Example user-level config (no secrets):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@0.0.83", "--browser", "chrome", "--isolated"]
    }
  }
}
```

`--isolated` keeps the browser profile in memory, so no cookies or session data persist on disk.
Do not point a developer MCP at a production deployment.
