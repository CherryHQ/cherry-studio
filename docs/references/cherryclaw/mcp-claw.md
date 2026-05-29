# Claw MCP Server

The Claw MCP server is a built-in MCP (Model Context Protocol) server automatically injected into every CherryClaw session. It provides four self-management tools for the agent: `cron` (task scheduling), `notify` (notifications), `skills` (skill management), and `memory` (memory management).

## Architecture

```
CherryClawService.invoke()
  → Create ClawServer instance (one new instance per invocation)
  → Inject as in-memory MCP server:
      _internalMcpServers = { claw: { type: 'inmem', instance: clawServer.mcpServer } }
  → ClaudeCodeService merges into SDK options.mcpServers
  → SDK auto-discovers tools: mcp__claw__cron, mcp__claw__notify, mcp__claw__skills, mcp__claw__memory
```

ClawServer uses the `@modelcontextprotocol/sdk` `McpServer` class, running in memory mode (no HTTP transport). A new instance is created per CherryClaw session invocation, bound to the current agent's ID.

## Tool Whitelist

When an agent has an explicit `allowed_tools` whitelist, `CherryClawService` automatically appends the `mcp__claw__*` wildcard to ensure the SDK doesn't filter out internal MCP tools. When `allowed_tools` is undefined (unrestricted), all tools are already available.

---

## cron Tool

Manages agent scheduled tasks. The agent can autonomously create, view, and delete periodically executed tasks.

### Actions

#### `add` — Create Task

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Task name |
| `message` | string | Yes | Prompt/instruction to execute |
| `cron` | string | One of three | Cron expression, e.g., `0 9 * * 1-5` |
| `every` | string | One of three | Duration, e.g., `30m`, `2h`, `1h30m` |
| `at` | string | One of three | RFC3339 timestamp for one-time tasks |
| `session_mode` | string | No | `reuse` (default, preserve conversation history) or `new` (new session each time) |

Only one of `cron`, `every`, `at` can be specified. `every` supports human-friendly duration formats, internally converted to minutes.

Schedule type mapping:
- `cron` → `schedule_type: 'cron'`
- `every` → `schedule_type: 'interval'` (value in minutes)
- `at` → `schedule_type: 'once'` (value as ISO timestamp)

Session mode mapping:
- `reuse` → `context_mode: 'session'`
- `new` → `context_mode: 'isolated'`

#### `list` — List Tasks

No parameters. Returns all scheduled tasks for the current agent (limit 100), in JSON format.

#### `remove` — Delete Task

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Task ID |

---

## notify Tool

Send notification messages to users through connected channels (e.g., Telegram). The agent can proactively notify users of task results, status updates, or other important information.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message` | string | Yes | Notification content |
| `channel_id` | string | No | Send to specific channel only (omit to send to all notification channels) |

### Behavior

1. Get all `is_notify_receiver: true` channel adapters for the current agent
2. If `channel_id` is specified, filter to that channel
3. Send message to all `notifyChatIds` of each adapter
4. Return send count and any errors

Returns an informational message (not an error) if no notification channels are configured.

---

## skills Tool

Manage Claude skills in the agent workspace. Supports searching from the marketplace, installing, uninstalling, and listing installed skills.

### Actions

#### `search` — Search Skills

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search keywords |

Queries the public marketplace API (`claude-plugins.dev/api/skills`), returns matching skills with `name`, `description`, `author`, `identifier` (for installation), and `installs` count. Hyphens and underscores in search terms are replaced with spaces to improve matching.

#### `install` — Install Skill

| Parameter | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | Yes | Marketplace skill identifier, format `owner/repo/skill-name` |

Constructs `marketplace:skill:{identifier}` path internally, delegates to `PluginService.install()`.

#### `remove` — Uninstall Skill

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Skill folder name (from list results) |

Delegates to `PluginService.uninstall()`.

#### `list` — List Installed Skills

No parameters. Returns all installed skills for the current agent, including `name`, `folder`, and `description`.

---

## memory Tool

Manage persistent cross-session memory. This is the write interface for CherryClaw's memory system (reading is done via inline content in the system prompt).

### Design Principle

The tool description encodes the memory decision logic:

> Before writing to FACT.md, ask yourself: will this information still matter in 6 months? If not, use append instead.

### Actions

#### `update` — Update FACT.md

| Parameter | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes | Complete markdown content of FACT.md |

Atomic write: writes to a temp file first, then replaces via `rename`. Ensures no file corruption from mid-write crashes.

File path supports case-insensitive matching. The `memory/` directory is auto-created if it doesn't exist.

**Note**: This is a full overwrite, not an incremental edit. The agent needs to read existing content first, modify it, then write back the complete content.

#### `append` — Append Log Entry

| Parameter | Type | Required | Description |
|---|---|---|---|
| `text` | string | Yes | Log entry text |
| `tags` | string[] | No | Tag list |

Appends a JSON line to `memory/JOURNAL.jsonl`:

```json
{"ts":"2026-03-10T12:00:00.000Z","tags":["deploy","production"],"text":"Deployed v2.1 to production"}
```

Timestamp is auto-generated. Suitable for one-off events, completed tasks, session summaries, and other short-term information.

#### `search` — Search Logs

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | No | Case-insensitive substring match |
| `tag` | string | No | Filter by tag |
| `limit` | integer | No | Max results (default 20) |

Returns matching log entries in reverse chronological order. `query` and `tag` can be combined.

---

## Error Handling

All tool calls execute within an internal try-catch. On error, returns an `{ isError: true }` MCP response with the error message. Errors are also logged to `loggerService`.

## Key Files

| File | Description |
|---|---|
| `src/main/mcpServers/claw.ts` | ClawServer complete implementation (4 tools + helpers) |
| `src/main/mcpServers/__tests__/claw.test.ts` | 37 unit tests |
| `src/main/services/agents/services/cherryclaw/index.ts` | MCP server injection logic |
