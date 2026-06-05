# Claw MCP Server

The Claw MCP server is a built-in MCP (Model Context Protocol) server automatically injected into every CherryClaw (Soul Mode) session. It provides three self-management tools for the agent: `cron` (task scheduling), `notify` (notifications), and `config` (agent/channel self-configuration). Skill and memory management used to live here too but were extracted into their own standalone MCP servers (see [Related servers](#related-servers-formerly-claw-tools)).

## Architecture

```
CherryClawService.invoke()
  → Create ClawServer instance (one new instance per invocation)
  → Inject as in-memory MCP server:
      _internalMcpServers = { claw: { type: 'inmem', instance: clawServer.mcpServer } }
  → ClaudeCodeService merges into SDK options.mcpServers
  → SDK auto-discovers tools: mcp__claw__cron, mcp__claw__notify, mcp__claw__config
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

## config Tool

Inspect and manage the agent's own configuration — identity, model, and IM channel connections — and drive the onboarding ("bootstrap") ritual.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | Yes | One of the actions below |
| `type` | string | For `add_channel` | Channel adapter type: `telegram` / `feishu` / `qq` / `wechat` / `discord` / `slack` |
| `name` | string | For `rename` / `add_channel` | New display name (`rename`) or human-readable channel name (`add_channel`) |
| `channel_id` | string | For `update_channel` / `remove_channel` / `reconnect_channel` | Target channel id |
| `config` | object | For `add_channel` | Adapter-specific configuration (optional for `update_channel`) |
| `enabled` | boolean | No | Enable/disable the channel (defaults to true) |

### Actions

| Action | Description |
|---|---|
| `status` | Current channels, model, and supported adapter types |
| `rename` | Change the agent's display name |
| `add_channel` / `update_channel` / `remove_channel` | Manage IM channel connections |
| `reconnect_channel` | Re-scan a QR code for a WeChat/Feishu channel (e.g. expired session or failed initial setup) |
| `complete_bootstrap` | Mark the onboarding ritual as done |
| `reset_bootstrap` | Re-run onboarding in the next session |

---

## Related servers (formerly claw tools)

Skill and memory management were extracted out of claw into their own standalone MCP servers:

| Capability | Server | Tool | File |
|---|---|---|---|
| Skills (search / install / uninstall / list) | `skills` | `mcp__skills__skills` | `src/main/ai/mcp/servers/skills.ts` |
| Persistent memory (update / append / search) | `agent-memory` | `mcp__agent-memory__memory` | `src/main/ai/mcp/servers/workspaceMemory.ts` |

> The CherryClaw system prompt and the workspace bootstrap reference memory as `mcp__agent-memory__memory` — **not** `mcp__claw__memory`.

---

## Error Handling

All tool calls execute within an internal try-catch. On error, returns an `{ isError: true }` MCP response with the error message. Errors are also logged to `loggerService`.

## Key Files

| File | Description |
|---|---|
| `src/main/ai/mcp/servers/claw.ts` | ClawServer implementation (`cron` / `notify` / `config` + helpers) |
| `src/main/ai/mcp/servers/__tests__/claw.test.ts` | Unit tests |
| `src/main/ai/runtime/claudeCode/settingsBuilder.ts` | `buildMcpServers` — injects the claw server in Soul Mode |
