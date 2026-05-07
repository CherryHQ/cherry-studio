# CherryClaw 整体设计

<p align="center">
  <img src="./cherryclaw.png" width="200" alt="CherryClaw" />
</p>

CherryClaw 是 Cherry Studio 中的自主代理（autonomous agent）类型，基于 Claude Agent SDK 构建。与标准的 claude-code 代理不同，CherryClaw 拥有独立的人格系统、基于任务的调度器、IM 频道集成，以及一组通过内部 MCP 服务器提供的自主管理工具。

## 架构概览

```
CherryClawService
  ├── PromptBuilder        — 从工作区文件组装完整系统提示词
  ├── HeartbeatReader      — 读取心跳文件内容（用于调度任务前置提示）
  ├── ClawServer (MCP)     — 内置 MCP 服务器，提供 cron / notify / skills / memory 工具
  ├── SchedulerService     — 60s 轮询调度器，从 DB 查询到期任务并执行
  ├── TaskService          — 任务 CRUD + 下次运行时间计算
  └── ChannelManager       — 频道适配器生命周期管理（Telegram 等）
```

## 核心设计决策

### AgentServiceRegistry 模式

`SessionMessageService` 不再硬编码 `ClaudeCodeService`，而是通过 `AgentServiceRegistry` 根据 `AgentType` 查找对应的服务实现。CherryClaw 在运行时通过注册表委托给 claude-code 执行。

```typescript
// src/main/services/agents/services/AgentServiceRegistry.ts
agentServiceRegistry.register('claude-code', new ClaudeCodeService())
agentServiceRegistry.register('cherry-claw', new CherryClawService())
```

### 自定义系统提示词（替换 Claude Code 预设）

CherryClaw 不使用 Claude Code 的预设系统提示词。`PromptBuilder` 从工作区文件组装完整的自定义提示词，通过 `_systemPrompt` 字段传递给 `ClaudeCodeService`。当该字段存在时，它作为完整的系统提示词使用，而非预设 + 追加模式。

### 禁用不适用的内置工具

CherryClaw 通过 `_disallowedTools` 禁用了一组不适合自主运行的 SDK 内置工具：

| 被禁用的工具 | 原因 |
|---|---|
| `CronCreate` / `CronDelete` / `CronList` | 由内部 MCP cron 工具替代 |
| `TodoWrite` | 不适合自主代理 |
| `AskUserQuestion` | 自主代理不应向用户提问 |
| `EnterPlanMode` / `ExitPlanMode` | 不适合自主代理 |
| `EnterWorktree` / `NotebookEdit` | 不适合自主代理 |

## 调用流程

```
CherryClawService.invoke()
  1. PromptBuilder.buildSystemPrompt(workspacePath)
     → 加载 system.md（可选覆盖）+ soul.md + user.md + memory/FACT.md
     → 组装为完整系统提示词
  2. 创建 ClawServer 实例（内存中的 MCP 服务器）
     → 注入为 _internalMcpServers = { claw: { type: 'inmem', instance } }
  3. 设置 _disallowedTools（禁用不适用工具）
  4. 如果 agent 有 allowed_tools 白名单，追加 mcp__claw__* 通配符
  5. 委托给 ClaudeCodeService.invoke()
     → 使用 _systemPrompt 作为完整替换
     → 合并 _internalMcpServers 到 SDK options.mcpServers
     → Claude SDK 自动发现 cron / notify / skills / memory 工具
```

## 记忆系统

CherryClaw 采用受 Anna 启发的三文件记忆模型，每个文件有独立的职责范围：

```
{workspace}/
  system.md              — 可选的系统提示词覆盖（替换默认 CherryClaw 身份）
  soul.md                — 你是谁：人格、语气、沟通风格
  user.md                — 用户是谁：名字、偏好、个人上下文
  memory/
    FACT.md              — 你知道什么：持久的项目知识、技术决策（6 个月以上）
    JOURNAL.jsonl        — 事件日志：一次性事件、已完成任务、会话笔记（仅追加）
```

关键规则：
- 每个文件有独立作用域，不跨文件重复信息
- `soul.md` 和 `user.md` 通过 Read/Edit 工具直接编辑
- `FACT.md` 和 `JOURNAL.jsonl` 通过 `memory` MCP 工具管理
- 代理自主更新，不请求用户批准
- 文件名不区分大小写

### PromptBuilder 缓存机制

`PromptBuilder` 对所有文件读取使用基于 mtime 的缓存。每次读取时仅执行一次 `fs.stat` 检查——如果文件修改时间未变，直接返回缓存内容，无需持久化文件监听器。

## 数据库

CherryClaw 使用 Drizzle ORM + LibSQL（SQLite）存储任务数据：

| 表名 | 用途 |
|---|---|
| `scheduled_tasks` | 调度任务（名称、提示词、调度类型、下次运行时间、状态） |
| `task_run_logs` | 任务运行日志（运行时间、耗时、状态、结果/错误） |

两个表均通过外键级联关联到 agents 表。

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/v1/agents/:agentId/tasks` | 列出任务 |
| `POST` | `/v1/agents/:agentId/tasks` | 创建任务 |
| `GET` | `/v1/agents/:agentId/tasks/:taskId` | 获取任务详情 |
| `PATCH` | `/v1/agents/:agentId/tasks/:taskId` | 更新任务 |
| `DELETE` | `/v1/agents/:agentId/tasks/:taskId` | 删除任务 |
| `POST` | `/v1/agents/:agentId/tasks/:taskId/run` | 手动触发运行 |
| `GET` | `/v1/agents/:agentId/tasks/:taskId/logs` | 获取运行日志 |

## 关键文件

| 文件 | 说明 |
|---|---|
| `src/main/services/agents/services/cherryclaw/index.ts` | CherryClawService 入口 |
| `src/main/services/agents/services/cherryclaw/prompt.ts` | PromptBuilder 系统提示词组装 |
| `src/main/services/agents/services/cherryclaw/heartbeat.ts` | HeartbeatReader 心跳文件读取 |
| `src/main/services/agents/services/AgentServiceRegistry.ts` | 代理服务注册表 |
| `src/main/services/agents/services/TaskService.ts` | 任务 CRUD + 调度计算 |
| `src/main/services/agents/services/SchedulerService.ts` | 轮询调度器 |
| `src/main/mcpServers/claw.ts` | Claw MCP 服务器 |
| `src/main/services/agents/services/channels/` | 频道抽象层 |
| `src/main/services/agents/database/schema/tasks.schema.ts` | 任务表 schema |
