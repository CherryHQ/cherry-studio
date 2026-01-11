# Hub MCP Server

A built-in MCP server that aggregates all active MCP servers in Cherry Studio and exposes them through `search` and `exec` tools.

## Overview

The Hub server enables LLMs to discover and call tools from all active MCP servers without needing to know the specific server names or tool signatures upfront.

## Auto Mode Integration

The Hub server is the core component of Cherry Studio's **Auto MCP Mode**. When an assistant is set to Auto mode:

1. **Automatic Injection**: The Hub server is automatically injected as the only MCP server for the assistant
2. **System Prompt**: A specialized system prompt (`HUB_MODE_SYSTEM_PROMPT`) is appended to guide the LLM on how to use the `search` and `exec` tools
3. **Dynamic Discovery**: The LLM can discover and use any tools from all active MCP servers without manual configuration

### MCP Modes

Cherry Studio supports three MCP modes per assistant:

| Mode | Description | Tools Available |
|------|-------------|-----------------|
| **Disabled** | No MCP tools | None |
| **Auto** | Hub server only | `search`, `exec` |
| **Manual** | User selects servers | Selected server tools |

### How Auto Mode Works

```
User Message
     │
     ▼
┌─────────────────────────────────────────┐
│ Assistant (mcpMode: 'auto')             │
│                                         │
│ System Prompt + HUB_MODE_SYSTEM_PROMPT  │
│ Tools: [hub.search, hub.exec]           │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ LLM decides to use MCP tools            │
│                                         │
│ 1. search({ query: "github,repo" })     │
│ 2. exec({ code: "await searchRepos()" })│
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ Hub Server                              │
│                                         │
│ Aggregates all active MCP servers       │
│ Routes tool calls to appropriate server │
└─────────────────────────────────────────┘
```

### Relevant Code

- **Type Definition**: `src/renderer/src/types/index.ts` - `McpMode` type and `getEffectiveMcpMode()`
- **Hub Server Constant**: `src/renderer/src/store/mcp.ts` - `hubMCPServer`
- **Server Selection**: `src/renderer/src/services/ApiService.ts` - `getMcpServersForAssistant()`
- **System Prompt**: `src/renderer/src/config/prompts.ts` - `HUB_MODE_SYSTEM_PROMPT`
- **Prompt Injection**: `src/renderer/src/aiCore/prepareParams/parameterBuilder.ts`

## Tools

### `search`

Search for available MCP tools by keywords.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | Yes | Search keywords, comma-separated for OR matching |
| `limit` | number | No | Maximum results to return (default: 10, max: 50) |

**Example:**
```json
{
  "query": "browser,chrome",
  "limit": 5
}
```

**Returns:** JavaScript function declarations with JSDoc comments that can be used in the `exec` tool.

```javascript
// Found 2 tool(s):

/**
 * Launch a browser instance
 *
 * @param {{ browser?: "chromium" | "firefox" | "webkit", headless?: boolean }} params
 * @returns {Promise<unknown>}
 */
async function launchBrowser(params) {
  return await __callTool("browser__launch_browser", params);
}
```

### `exec`

Execute JavaScript code that calls MCP tools.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `code` | string | Yes | JavaScript code to execute |

**Built-in Helpers:**
- `parallel(...promises)` - Run multiple tool calls concurrently (Promise.all)
- `settle(...promises)` - Run multiple tool calls and get all results (Promise.allSettled)
- `console.log/warn/error/info/debug` - Captured in output logs

**Example:**
```javascript
// Call a single tool
const result = await searchRepos({ query: "react" });
return result;

// Call multiple tools in parallel
const [users, repos] = await parallel(
  getUsers({ limit: 10 }),
  searchRepos({ query: "typescript" })
);
return { users, repos };
```

**Returns:**
```json
{
  "result": { "users": [...], "repos": [...] },
  "logs": ["[log] Processing..."],
  "error": null
}
```

## Usage Flow

1. **Search** for tools using keywords:
   ```
   search({ query: "github,repository" })
   ```

2. **Review** the returned function signatures and JSDoc

3. **Execute** code using the discovered tools:
   ```
   exec({ code: 'return await searchRepos({ query: "react" })' })
   ```

## Configuration

The Hub server is a built-in server identified as `@cherry/hub`.

### Using Auto Mode (Recommended)

The easiest way to use the Hub server is through Auto mode:

1. Click the **MCP Tools** button (hammer icon) in the input bar
2. Select **Auto** mode
3. The Hub server is automatically enabled for the assistant

### Manual Configuration

Alternatively, you can enable the Hub server manually:

1. Go to **Settings** → **MCP Servers**
2. Find **Hub** in the built-in servers list
3. Toggle it on
4. In the assistant's MCP settings, select the Hub server

## Caching

- Tool definitions are cached for **10 minutes**
- Cache is automatically refreshed when expired
- Cache is invalidated when MCP servers connect/disconnect

## Limitations

- Code execution has a **60-second timeout**
- Console logs are limited to **1000 entries**
- Search results are limited to **50 tools** maximum
- The Hub server excludes itself from the aggregated server list

## Architecture

```
LLM
 │
 ▼
HubServer
 ├── search → ToolRegistry → SearchIndex
 └── exec   → Runtime → callMcpTool()
                            │
                            ▼
                      MCPService.callTool()
                            │
                            ▼
                   External MCP Servers
```

## Files

| File | Description |
|------|-------------|
| `index.ts` | Main HubServer class |
| `types.ts` | TypeScript type definitions |
| `generator.ts` | Converts MCP tools to JS functions with JSDoc |
| `tool-registry.ts` | In-memory tool cache with TTL |
| `search.ts` | Keyword-based tool search |
| `runtime.ts` | JavaScript code execution engine |
| `mcp-bridge.ts` | Bridge to Cherry Studio's MCPService |
