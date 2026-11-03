# Agent Note: 在加载 payload 前限制智能体会话消息读取量

Status: implemented

[English](2026-11-03-agent-session-message-read-budget.md) | 中文

## 问题

Issue #23359 报告了读取智能体会话历史时的内存分配失败。旧的 `listSessionMessages` 路径先物化完整行并解析 JSON，之后 handler 才能延后加载大型工具输出。消息条数上限无法约束 payload 字节数，事后投影响应也就无法保护读取过程本身。首屏读取失败还可能在渲染层显示为空会话。

## 决策

`src/main/data/services/AgentSessionMessageService.ts` 负责读取预算和投影。`listSessionMessages` 在同步 deferred 只读事务内，先用 SQL `coalesce(octet_length(column), 0)` 只读 `limit+1` 行的元数据，再预检单条和整页输入预算。sentinel 只用于判断 `hasNext`，不计入预算，也不读取其 payload。随后按当前页各 id，用主键 `.get()` 逐条取行，经 `rowToEntity`、可选投影、返回实体预算检查后才保留实体，处理完当前页再计算 `nextCursor`。

单条输入预算为 16 MiB（`AGENT_SESSION_MESSAGE_READ_INPUT_BUDGET`）。整页输入预算在 `deferToolOutputs=true` 时为 512 MiB，缺省或 false 时为 16 MiB。整页返回实体预算为 16 MiB。比较一律在 `>` 时才拒绝，等于预算允许通过。

超预算抛出 `DataApiError`，携带 `INVALID_OPERATION`、`isRetryable=false`、`details.reason=AGENT_SESSION_MESSAGE_READ_BUDGET_EXCEEDED`，并包含 `operation/scope/sessionId/messageId/bytes/budget/deferToolOutputs`。原生 `SQLITE_NOMEM` 和 `SQLITE_IOERR_NOMEM` 沿 `cause` 链识别后，以 `AGENT_SESSION_MESSAGE_READ_ALLOCATION_FAILED` 上报，带 `nativeCode` 和 `stage`。其它异常保持原样。

投影归属从 handler 移入 service，通过 `ListSessionMessagesOptions.deferToolOutputs` 控制。缺省仍为 false，返回保留原文内容的公开实体。true 时逐条使用既有 `projectMessagePartsForRenderer` 投影；其 32 KiB 阈值、citation skeleton 和 `$persistedToolOutput` 信封语义不变。

`useAgentSessionParts` 暴露 query `error`，并在错误态抑制 `loadOlder`。`useAgentChatRuntimeState` 透传 `historyError`。`AgentChat` 在消息列表上方用既有 `Alert`、`common.error` 和 `formatErrorMessage` 显示失败，失败首屏不再当作空会话。

## 备选方案

- 将投影留在 handler：不采用，因为投影能缩减响应时，service 已物化并解析了整页。
- 只依赖消息条数分页：不采用，因为少量消息也可能超过输入预算；必须在读取 payload 前检查元数据。
- 只捕获分配错误，不做预算预检：不采用，因为 V8 堆耗尽会直接终止进程，无法返回可恢复的查询错误。
- 对所有消费者延后加载工具输出：不采用，因为缺省和 false 读取必须保留内部消费者使用的公开实体原文；这些读取改用较小的整页输入预算。

## 影响

service 在读取 payload 前检查输入大小，开启延后加载时也不再保留整页未经投影的实体。元数据检查和 payload 读取处于同一个同步事务中。预算拒绝明确且不可重试；渲染层展示历史读取失败，不再静默显示为空会话。

相同的安全拒绝也作用于缺省 false 的内部消费者：remote journal/query、doctor、`readConversation` 和附件读取。超大历史在这些路径上也可能失败。这是已选定的政策，不是本 PR 引入的静默行为。

16/512 MiB 上限是明确的安全政策，不是任意数据形状或任意内存压力下的绝对 OOM 保证。50×8 MiB 的读取在主线程上仍耗时数百毫秒。本轮未复现原报告的 Windows `SQLITE_NOMEM`；V8 低堆 `SIGABRT` 不等于 Windows 原生分配失败。真实 Electron UI 验收与 CI 结果不在本轮证据范围内，本 note 不作此声明。

## 验证

- Regression — `node node_modules/vitest/vitest.mjs run --project main` 显式筛选 `AgentSessionMessageService.test.ts`、`agentSessionMessages.test.ts`、`agentSessionMessages.list.test.ts`、`messageOutputProjection.test.ts`、`ApiServer.test.ts`、`agent.test.ts`、`agentPagination.test.ts`、`doctorIncident.test.ts`、`readConversation.test.ts` 和 `AssistantFileToolsServer.test.ts`：10 文件 / 255 通过，覆盖 service、handler、投影及受影响的消费者。
- Regression — 本轮 shared 验证：1 文件 / 10 通过；`tsc -p tsconfig.node.json`、oxlint、eslint、oxfmt 退出 0。
- Regression — `--project renderer` 显式筛选 `useAgentSessionParts.test.ts`、`AgentChatHistoryError.test.tsx`、`useAgentChatRuntimeState.test.tsx` 和 `DataApiService.test.ts`：4 文件 / 83 通过；`tsc -p tsconfig.web.json`、lint、format 退出 0，覆盖错误透传、历史失败展示及分页行为。
- Regression — `--max-old-space-size=64` 隔离子进程对照，旧路径和新实现各跑 3 次，4×8 MiB true：旧路径 3/3 SIGABRT（V8 `JsonParser` OOM）；新实现 3/3 完整返回、ref 正确，读取阶段采样 RSS 197.83–199.61 MiB。
- Regression — 同一低堆对照，50×8 MiB true：旧路径 3/3 abort；新实现 3/3 成功，读取阶段采样 RSS 198.58–199.50 MiB，同步耗时 420–575 ms。
- Regression — 同一低堆对照，单条 64 MiB：旧路径 3/3 abort；新实现 3/3 在读取 payload 前拒绝（`rejectedPayloadGets=0`），之后健康小页正常读取，进程退出 0。
- Regression — 默认/false 的 4×8 MiB、50×8 MiB 在 `page-input` 预检拒绝（`rejectedPayloadGets=0`），之后健康小页仍可读取。
