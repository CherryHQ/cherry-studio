# Agent Note: 会话拥有模型选择

Status: implemented

[English](2026-11-14-agent-session-model-ownership.md) | 中文

## Problem

对话中的模型选择器原本修改共享的智能体模型。在一个对话中选择模型，因此也会改变兄弟会话以及定时任务使用的默认模型。只迁移选择器的写入位置仍不足以修复问题：提示词变量、工具、运行时校验和连接创建可能继续读取不同的模型来源，尤其是在活动轮次期间发生编辑时。

## Decision

交互式对话将模型选择持久化到 `agent_session.model`。有效模型为 `session.model ?? agent.model`；未选择模型的会话跟随智能体默认值。定时任务及其他 headless 轮次使用智能体默认模型。智能体仍拥有其默认模型和其他认知配置。

轮次准备阶段捕获有效模型。运行时连接创建、提示词变量以及依赖模型的工具使用该捕获值，避免后续编辑将已接纳的轮次改派到其他模型。持久运行时恢复优先保留历史已保存请求的模型，再考虑当前会话或智能体默认值。当前运行时行为记录在[智能体会话运行时](../../../../docs/dev/references/ai/agent-session-runtime.md)和[智能体提示词分层](../../../../docs/dev/references/ai/agent-prompt-layers.md)中。

## Alternatives considered

- 保留智能体级模型选择并在切换前警示：确认操作无法消除共享状态变更，也不能保护兄弟对话和定时任务。
- 仅将选择保存在渲染进程缓存中：跨窗口、重启、分叉和运行时恢复时，模型选择没有持久的会话所有者。
- 每个消费者都重新解析当前选择：轮次中途编辑可能让已捕获的请求混用其他模型的提示词或工具。

## Consequences

新增的可空外键让已有会话继续跟随智能体默认模型。删除所选模型时，`ON DELETE SET NULL` 清除覆盖值；删除通知使受影响且已挂载的会话刷新。分叉继承覆盖值，并在提交前拒绝源会话模型发生变化的情况。重新分配智能体保留会话绑定的运行时及其模型覆盖值，包括 Claude 订阅模型。对于 Pi 和 Pi Durable 会话，不兼容的原有覆盖值会随重新分配一起原子清除。运行时归属遵循[会话运行时绑定](../../proposed/architecture/2026-11-12-session-runtime-binding.md)，而不取决于替换后的智能体类型。

该方案将交互模型选择与智能体默认值分开，不把其他智能体设置变成会话设置。会话编辑后，已捕获的轮次和历史已保存请求可以有意保留较早的模型选择。

## Verification

- Regression — 聚焦 Main 测试运行包含 `src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts` 和 `src/main/ai/runtime/claudeCode/__tests__/buildMcpServers.test.ts`：Durable 提示词和 `create_agent` 使用已捕获的模型，同一后端内其他会话的恢复保留已保存请求的选择，MCP 路由使用连接的有效模型。
- Regression — 聚焦 renderer 测试运行包含 `src/renderer/windows/selection/agent/components/__tests__/SelectionAgentConversation.test.tsx`、`src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx` 和 `src/renderer/pages/agents/__tests__/useAgentConversationBootstrap.test.ts`：划词窗口对话及输入框使用会话模型，初始化时优先解析会话覆盖值，再回退到智能体默认模型。
- Regression — `pnpm typecheck:node` 和 `pnpm typecheck:web` 通过。

这些结果仅覆盖本次修复的本地检查。尚未验证 Electron 交互、真实提供商执行和新 head 的 CI；较早 head 的绿色 CI 不能证明后续修改通过验证。
