# Agent Note: Agent 会话消息读取超时与超大工具输出存储剥离

Status: implemented

[English](2026-11-08-agent-session-tool-output-storage.md) | 中文

## 问题

在 Agent 活跃执行期间或打开包含大量工具调用的会话时，`GET /agent-sessions/:sessionId/messages` 频繁触发渲染进程 DataApi 的 3 秒超时：

1. `agent_session_message.data` 将完整的工具输出内联存储在消息 JSON 中。由于 `better-sqlite3` 与 `JSON.parse(row.data)` 在 Electron 主线程同步执行，分页加载会话消息（`limit=50`）时必须把整页所有超大工具输出全部读入并反序列化，随后才由 `projectMessagesOutputForRenderer` 裁剪为 `$deferredToolResult` 摘要标记。
2. 在流式输出和终态落盘期间，`AgentSessionMessageService.upsertMessage` / `replaceMessageParts` 每次都会重新序列化整条消息的 `data` JSON（包含已完成的超大工具输出），并且每次更新都会无条件触发 `agent_session_message_au` FTS5 触发器（包括仅修改 `parentId` 等元数据的更新），在 SQLite 中重复执行 `json_each(NEW.data, '$.parts')` 及 FTS 删插。
3. `projectToolOutputForRenderer` 对每个超大工具输出执行了两次 `JSON.stringify(output)`（分别在 `measureJsonBytes` 和 `computeToolOutputRevision` 中），且不论输出结构如何都无条件执行 4 个引用来源的 Zod `safeParse`。
4. `RootMessageProjection` 在构造函数中按 range 重复调用 `hasSessionMessage`（执行 `SELECT *` + `rowToEntity`）与 `getSessionMessage`，而未按唯一 `messageId` 去重；`ChildThreadProjection` 在构造时重复调用了两次 `readAgentSessionPath`。
5. `ai.message.readToolOutput` 为了读取单个 `toolCallId` 的输出，需要加载并解析整条 `agent_session_message` 记录。

## 决策

本存储层位于[工具结果 Spec](../architecture/2026-11-09-tool-result-projection-boundaries.md) 之上。它删除旁路结果表的 revision 列，每个调用只保留最新输出。最终实现以定向失效替代结果 revision；其架构说明记录存储、投影与详情的累计验证。

1. **独立工具输出旁路表（`agent_session_tool_output`）**：
   - 新增 `agent_session_tool_output` 表（`message_id`、`tool_call_id`、`session_id`、`output`、`revision`、`created_at`、`updated_at`），采用复合主键 `(message_id, tool_call_id)`，并对 `agent_session_message(id)` 与 `agent_session(id)` 配置 `ON DELETE CASCADE` 外键。
   - 在写入路径（`upsertMessage`、`replaceMessageParts`、`updateSessionMessage`、`insertForkMessagesTx`、`resolveCrashOrphanedMessages`）中，`AgentSessionMessageService` 将超过 `DEFER_TOOL_OUTPUT_BYTES`（32 KiB）的已完成工具输出剥离至 `agent_session_tool_output`，主表 `agent_session_message.data` 仅保留轻量的 `$deferredToolResult` 标记（引用标识 `sessionId`、`messageId`、`toolCallId`、`revision`，以及可选的 `excerpt` 与 `skeleton`）。
   - `syncMessageToolOutputsTx` 在同一 `(message_id, tool_call_id)` 键下覆盖当前输出。`setWhere: output IS NOT excluded.output` 在序列化内容相同时跳过写入，不保存结果 revision。更新复用 `excluded.output`，不再次序列化同一个值。
2. **按需延迟读取与批量回填**：
   - `listSessionMessages(sessionId, { deferToolOutputs: true })` 直接读取紧凑的 `agent_session_message` 行，无需查询 `agent_session_tool_output`；同时对存量内联旧数据保留内存裁剪以兼容历史会话。
   - 需要完整工具输出的调用方（`getSessionMessage`、`listApprovalMessages`、`findCrashOrphanedAssistantMessages`、`readAgentSessionPath`、`readRetiredAgentSessionHistory` 以及未开启 `deferToolOutputs` 的 `listSessionMessages`）按 `SQLITE_INARRAY_CHUNK` 分块从 `agent_session_tool_output` 批量回填 `$deferredToolResult` 标记。
   - `getSessionToolOutput(sessionId, messageId, toolCallId)` 与 `findPersistedToolOutput` 优先对 `agent_session_tool_output` 执行 O(1) 主键点查，仅在存量未剥离行或内联小输出时回退到 `getSessionMessage`。
   - `agentSessionMessageEntityJsonBytes()` 计入旁路表输出与占位标记的字节差值，保证诊断元数据分页（`listLiveCreatedInRangeMetadataPage`）计算的 `entityJsonBytes` 与 `JSON.stringify(getSessionMessage(sessionId, id))` 严格一致。
3. **热路径优化与 FTS 触发器守卫**：
   - `agent_session_message_au` 增加 `WHEN OLD.data IS NOT NEW.data` 守卫，使仅更新元数据的操作跳过 FTS5 重新分词。
   - `projectToolOutputForRenderer` 通过 `serializeOversizedToolOutput` 将超大输出的序列化合并为单次，并在 `toCitationPayloadSkeleton` 中先按载荷形状（`Array.isArray(output)` 或 `typeof output.conceptId === 'string'`）做轻量预检，再执行 Zod 校验。
   - `RootMessageProjection` 按 `messageId` 对 `hasSessionMessage`（改为仅 `SELECT id`）和 `getSessionMessage` 去重；`ChildThreadProjection` 在构造期间复用单次 `readAgentSessionPath` 结果。

## 备选方案

- **将渲染进程 `/agent-sessions/:sessionId/messages` 的超时阈值调大到 15 秒（PR #23718）**：不采用，因为这只是掩盖主线程阻塞，既没有减少 SQLite 同步 I/O，也没有降低 JSON 序列化开销。
- **复用旧版 Chat 的 `aiSdk/contextBuild`（`$persistedToolOutput` + `FileManager` 落盘文件）**：不采用，因为未来 Chat 将作为 Agent Profile 统一收敛到 `agent-runtime`，旧版 `aiSdk` Chat 消息管线将退役；将 `agent-runtime` 反向耦合到旧版 Chat 的文件落盘生命周期会违背演进方向，并使会话/分支删除时的事务级联清理复杂化。
- **在应用启动时对所有存量 `agent_session_message` 执行全量回填迁移**：不采用，因为启动时执行 O(N) 数据重写会导致大型数据库启动缓慢；采用渐进式共存（存量内联行读取时无缝兼容、写入时自动剥离）可以零启动开销实现完整兼容。

## 影响

- 已拆分的消息行不包含超大工具正文，因此紧凑分页不解析这些正文。这不代表所有会话都达到固定分页延迟，也不代表消除了其他同步流式处理。
- 删除会话、消息或分支时，SQLite `ON DELETE CASCADE` 会在同一事务内自动清理旁路工具输出。
- 变更前持久化的存量消息无需破坏性迁移即可正常读取与按需展开。

## 验证

- Regression — `pnpm test:main src/main/data/services/__tests__/AgentSessionMessageService.test.ts`：验证写入时剥离至 `agent_session_tool_output`、紧凑延迟读取、默认/单条回填读取、`getSessionToolOutput` 点查、`entityJsonBytes` 字节一致性、`replaceMessageParts` 未变内容跳过写入及同调用最新结果替换，以及级联删除。
- Regression — `pnpm test:main src/main/ai/runtime/pi/__tests__/retiredSessionHistory.test.ts`：验证孤儿崩溃恢复（crash-orphan recovery）后紧接着执行已退役 DSH 会话历史导入时，已剥离的超大工具输出能完整回填到恢复的 Pi 上下文中。
- Regression — `pnpm test:main src/main/utils/__tests__/messageOutputProjection.test.ts src/main/ai/messages/__tests__/readConversation.test.ts src/main/ipc/handlers/__tests__/ai.test.ts`：验证单次序列化投影、引用摘要骨架保留，以及 `ai.message.readToolOutput` 的 O(1) 点查。
- Regression — `pnpm test:main src/main/ai/agentSession/__tests__/RootMessageProjection.test.ts src/main/ai/agentSession/__tests__/ChildThreadProjection.test.ts`：验证按 `messageId` 去重查询与子线程归档单次读取初始化。
- Regression — `pnpm test:main src/main/data/db/__tests__/applyMigrations.test.ts src/main/data/db/__tests__/applyMigrations.populated.test.ts src/main/data/db/__tests__/ftsRebuild.test.ts`：验证迁移 `0036_agent_session_tool_output.sql` 与 `WHEN OLD.data IS NOT NEW.data` FTS 触发器完整性。
