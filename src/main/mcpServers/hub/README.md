# Hub MCP Server

A built-in MCP server that aggregates all active MCP servers in Cherry Studio and exposes them through **meta-tools**.

This server is the core component of Cherry Studio’s **Auto MCP Mode**.

## Tools (mcphub-aligned)

The Hub server exposes **four** tools:

- `list` — list tools (paginated with `limit` + `offset`)
- `inspect` — get a tool signature as a JSDoc stub
- `invoke` — call a single tool with parameters
- `exec` — execute JavaScript to orchestrate multiple tool calls via `mcp.callTool()`

> Note: Hub tool discovery is NOT web search. Use `list` to discover tools.

## Auto Mode Integration

When an assistant is set to Auto mode:

1. The Hub server is injected as the only MCP server for the assistant
2. A specialized system prompt is appended to guide the LLM on how to use `list/inspect/invoke/exec`
3. The LLM can discover and use any tools from all active MCP servers without manual configuration

## Usage Flow

1) **List** tools:

```json
{ "limit": 50, "offset": 0 }
```

2) **Inspect** a tool to see exact params:

```json
{ "name": "githubSearchRepos" }
```

3) **Invoke** a single tool:

```json
{ "name": "githubSearchRepos", "params": { "query": "mcp" } }
```

4) **Exec** multi-step workflows:

```javascript
const repos = await mcp.callTool("githubSearchRepos", { query: "mcp" })
return repos
```

## Naming

- Hub `list` returns both:
  - a JS-friendly name (camelCase), e.g. `githubSearchRepos`
  - the original tool id in parentheses, e.g. `github__search_repos`

Both formats are accepted by `inspect`, `invoke`, and `mcp.callTool()`.

## Caching

- Tool definitions are cached for **1 minute**
- Cache is invalidated when MCP servers connect/disconnect (via `invalidateCache()`)

## Limitations

- Code execution timeout: **60 seconds**
- Logs: max **1000** entries
- `list` result limit: max **100** entries per call
