# Agent Note: Agent 会话 Fork 前置可用性

Status: implemented

[English](2026-11-03-agent-session-fork-availability.md) | 中文

## 问题

Issue #23361 中，Fork 入口可以点击，却注定失败：`legacy_history`、`history_changed` 和 `not_turn_boundary` 三个守卫要到点击后才说明失败原因。`src/renderer/pages/agents/messages/agentSessionFork.ts` 的旧实现只根据消息角色和状态判定可用性。

## 决策

主进程只读探针返回三态：可用、不可用并附带既有原因，或未知。`ai.agent.session.fork_availability` 每批最多接收 200 个候选，去重并保持输入顺序。它复用抽出的 `prepareForkSource`，即真实 Fork 的只读准备流程。Claude 和 Pi 在内存中比较两次读取，校验已提交前缀，同时允许后缀追加；Pi 在裁剪后的保留路径上校验祖先。存在迁移 marker 时返回未知，且不触发迁移。

渲染层 hook 由事件驱动重验，不轮询，请求期限为三秒。未知状态仍允许点击，以保持现有操作能力，并给出 `operation_failed` 解释。真实 Fork 的契约、失败原因、持久化与 publication 保持不变。

## 考虑过的替代方案

- 将可用性加入消息 DataApi 响应会越过数据层只读 SQLite 的边界。
- 在 `ai.agent.session.fork` 上增加 `dryRun` 会改变既有契约。
- 渲染层从公开消息的 anchor 自行计算不可行：`publicMessageData` 已剔除 anchor，已提交前缀的校验也必须读取原生文件。
- 固定每五秒轮询会反复重读整个文件，成本不可接受。
- 对所有未知状态禁用 Fork 会让一次探针故障全局禁用入口，并挡住退役历史迁移现有的恢复路径。
- 原生菜单解释行留待后续处理；展示限制见下文。

## 影响

冷启动的新页面会重读该页涉及的原生文件；正常路径下每个文件读取两次内容。跨请求缓存留作后续工作。

没有用户交互时，外部修复不会自动反映；下一次窗口 focus、消息事件或新页面会触发重验。

`menu.presentation_mode=native` 时，菜单转换会丢失 description：原生菜单只有灰显而没有原因文案，cherry 菜单则显示真实 tooltip。

## 验证

- Regression — `src/shared/ipc/schemas/__tests__/ai.test.ts`：shared schema 测试套件 21 项通过。
- Regression — `src/main/ipc/handlers/__tests__/ai.test.ts`、`src/main/ai/agentSession/fork/__tests__/availability.test.ts`、`src/main/ai/runtime/claudeCode/__tests__/claudeForkAvailability.test.ts` 和 `src/main/ai/runtime/__tests__/registerDrivers.test.ts`：73 项通过；`src/main/data/services/__tests__/AgentSessionMessageService.test.ts`、`src/main/ai/agentSession/fork/__tests__/publication.test.ts` 和 `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`：200 项消费者测试通过。
- Regression — `src/main/ai/runtime/pi/__tests__/piForkAvailability.test.ts`、`src/main/ai/runtime/pi/PiRuntimeConnection.sdkContract.test.ts`、`src/main/ai/runtime/pi/__tests__/retiredSessionHistory.test.ts` 和 `src/main/ai/runtime/__tests__/registerDrivers.test.ts`：49 项通过。
- Regression — `src/renderer/pages/agents/messages/__tests__/agentSessionFork.test.ts`、`src/renderer/pages/agents/messages/__tests__/useAgentSessionForkAvailability.test.tsx`、`src/renderer/pages/agents/messages/__tests__/agentMessageListAdapter.test.tsx` 和 `src/renderer/components/chat/messages/frame/__tests__/messageMenuBarActions.test.tsx`：75 项通过；后续 hook 改动后，前三个文件的 37 项通过。
- Regression — 此前限定范围的 Node 和渲染层类型检查、ESLint、Oxlint、Oxfmt 检查通过；E2E 项目类型检查仍报告两个本 spec 之外的 `ReadableStream` 错误。
- Regression — `tests/e2e/smoke/agentSessionForkAvailability.test.ts`：用户本机 Electron 实测观察到可用 → 移除 Pi 原生 JSONL 后灰显并显示真实 tooltip → 恢复后重新可用；点击 Fork 确实创建了子会话并跳转。本次文档阶段未重跑收紧后的断言。
