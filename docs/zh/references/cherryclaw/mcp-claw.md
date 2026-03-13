# Claw MCP 服务器

Claw MCP 服务器是一个内置的 MCP（Model Context Protocol）服务器，自动注入到每个 CherryClaw 会话中。它为代理提供了四个自主管理工具：`cron`（任务调度）、`notify`（通知）、`skills`（技能管理）和 `memory`（记忆管理）。

## 架构

```
CherryClawService.invoke()
  → 创建 ClawServer 实例（每次调用一个新实例）
  → 注入为内存中的 MCP 服务器:
      _internalMcpServers = { claw: { type: 'inmem', instance: clawServer.mcpServer } }
  → ClaudeCodeService 合并到 SDK options.mcpServers
  → SDK 自动发现工具: mcp__claw__cron, mcp__claw__notify, mcp__claw__skills, mcp__claw__memory
```

ClawServer 使用 `@modelcontextprotocol/sdk` 的 `McpServer` 类，以内存模式运行（无需 HTTP 传输）。每个 CherryClaw 会话调用时创建新实例，绑定到当前 agent 的 ID。

## 工具白名单

当 agent 配置了显式的 `allowed_tools` 白名单时，`CherryClawService` 自动追加 `mcp__claw__*` 通配符，确保 SDK 不会过滤掉内部 MCP 工具。当 `allowed_tools` 为 undefined（无限制）时，所有工具已可用，无需注入。

---

## cron 工具

管理代理的调度任务。代理可以自主创建、查看和删除定期执行的任务。

### 动作

#### `add` — 创建任务

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 任务名称 |
| `message` | string | 是 | 执行时的提示词/指令 |
| `cron` | string | 三选一 | cron 表达式，如 `0 9 * * 1-5` |
| `every` | string | 三选一 | 持续时间，如 `30m`、`2h`、`1h30m` |
| `at` | string | 三选一 | RFC3339 时间戳，用于一次性任务 |
| `session_mode` | string | 否 | `reuse`（默认，保留对话历史）或 `new`（每次新会话） |

`cron`、`every`、`at` 三者只能选一个。`every` 格式支持 `30m`、`2h`、`1h30m` 等人类友好的时间表示，内部转换为分钟数。

调度类型映射：
- `cron` → `schedule_type: 'cron'`
- `every` → `schedule_type: 'interval'`（值为分钟数）
- `at` → `schedule_type: 'once'`（值为 ISO 时间戳）

会话模式映射：
- `reuse` → `context_mode: 'session'`
- `new` → `context_mode: 'isolated'`

#### `list` — 列出任务

无参数。返回当前 agent 的所有调度任务（上限 100 条），JSON 格式。

#### `remove` — 删除任务

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 任务 ID |

---

## notify 工具

通过已连接的频道（如 Telegram）向用户发送通知消息。代理可以主动通知用户任务结果、状态更新或其他重要信息。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message` | string | 是 | 通知内容 |
| `channel_id` | string | 否 | 仅发送到指定频道（省略则发送到所有通知频道） |

### 行为

1. 获取当前 agent 的所有 `is_notify_receiver: true` 的频道适配器
2. 如果指定了 `channel_id`，过滤到该频道
3. 向每个适配器的所有 `notifyChatIds` 发送消息
4. 返回发送数量和可能的错误

如果没有配置通知频道，返回提示信息而非报错。

---

## skills 工具

管理代理工作区中的 Claude 技能。支持从市场搜索、安装、卸载和列出已安装的技能。

### 动作

#### `search` — 搜索技能

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | 是 | 搜索关键词 |

查询公开市场 API（`claude-plugins.dev/api/skills`），返回匹配的技能列表，包含 `name`、`description`、`author`、`identifier`（用于安装）和 `installs` 数量。搜索词中的 `-` 和 `_` 会被替换为空格以提高匹配率。

#### `install` — 安装技能

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `identifier` | string | 是 | 市场技能标识符，格式 `owner/repo/skill-name` |

内部构造 `marketplace:skill:{identifier}` 路径，委托给 `PluginService.install()` 完成安装。

#### `remove` — 卸载技能

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 技能文件夹名称（从 list 结果获取） |

委托给 `PluginService.uninstall()` 完成卸载。

#### `list` — 列出已安装技能

无参数。返回当前 agent 已安装的所有技能，包含 `name`、`folder` 和 `description`。

---

## memory 工具

管理跨会话的持久化记忆。这是 CherryClaw 记忆系统的写入接口（读取通过系统提示词中的内联内容实现）。

### 设计原则

工具描述中编码了记忆决策逻辑：

> 写入 FACT.md 之前，问自己：这个信息 6 个月后还重要吗？如果不是，用 append 代替。

### 动作

#### `update` — 更新 FACT.md

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `content` | string | 是 | FACT.md 的完整 markdown 内容 |

原子写入：先写临时文件，再通过 `rename` 替换。确保不会出现写入中途崩溃导致的文件损坏。

文件路径支持大小写不敏感匹配。如果 `memory/` 目录不存在会自动创建。

**注意**：此操作是全量覆盖，不是增量编辑。代理需要先读取现有内容，修改后再写回完整内容。

#### `append` — 追加日志条目

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | 是 | 日志条目文本 |
| `tags` | string[] | 否 | 标签列表 |

追加一行 JSON 到 `memory/JOURNAL.jsonl`，格式：

```json
{"ts":"2026-03-10T12:00:00.000Z","tags":["deploy","production"],"text":"部署 v2.1 到生产环境"}
```

时间戳自动生成。适用于一次性事件、已完成任务、会话摘要等短期信息。

#### `search` — 搜索日志

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | 否 | 大小写不敏感的子串匹配 |
| `tag` | string | 否 | 按标签过滤 |
| `limit` | integer | 否 | 最大返回数量（默认 20） |

返回匹配的日志条目，按时间倒序排列。`query` 和 `tag` 可以组合使用。

---

## 错误处理

所有工具调用在内部 try-catch 中执行。当发生错误时，返回 `{ isError: true }` 的 MCP 响应，包含错误消息。错误同时记录到 `loggerService`。

## 关键文件

| 文件 | 说明 |
|---|---|
| `src/main/mcpServers/claw.ts` | ClawServer 完整实现（4 个工具 + 辅助函数） |
| `src/main/mcpServers/__tests__/claw.test.ts` | 37 个单元测试 |
| `src/main/services/agents/services/cherryclaw/index.ts` | MCP 服务器注入逻辑 |
