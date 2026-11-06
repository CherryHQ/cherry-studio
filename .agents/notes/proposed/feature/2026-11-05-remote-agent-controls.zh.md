# Agent Note: 远程智能体控制与单轮模型覆盖

Status: proposed

[English](2026-11-05-remote-agent-controls.md) | 中文

## Problem

通过远程访问从移动端连接到桌面 Cherry Studio 时，用户目前对正在进行和新创建的智能体控制有限：
1. 桌面转发到移动端的工具调用审批仅允许二元的是/否决策。若用户拒绝危险或不合规的工具调用，无法提供拒绝理由以引导智能体采用替代方案。
2. 移动端无法重命名远程智能体会话。桌面端保持权威存储，但缺少供远程客户端修改标题的 RPC 接口与状态变更广播。
3. 移动端的模型与思考强度选择以往存在直接修改全局 `agent` 表的风险，或者被完全禁用。由于多个桌面和移动端会话共享同一个智能体定义，全局修改会静默污染其他并发会话。

## Proposal

在协议、桌面服务与执行上下文中实现会话级远程智能体控制：

### 1. 能力协商与可用模型发现
- `connection.hello` 声明 `agentSessionRenameVersion: 1` 与 `agentModelSelectionVersion: 1`。版本不匹配时优雅降级并禁用对应控制项。
- `agent.agents.list` 返回智能体默认配置的 `reasoningEffort` 以及经过 `AGENT_RUNTIME_CAPABILITIES[agent.type].isModelCompatible` 过滤并由 `deriveThinkingOptions` 丰富思考选项的 `availableModels: AgentModelOption[]`。

### 2. 会话重命名接口 (`agent.sessions.update`)
- `@cherrystudio/remote-protocol` 声明 `AgentSessionUpdateMethod` (`agent.sessions.update`)，接收 `{ commandId, sessionId, title }`。
- 桌面端校验会话存在性，调用 `AgentSessionService.update(sessionId, { name: title })` 并设置 `isNameManuallyEdited = true`（防止大模型后续自动生成标题覆盖用户命名），在 `RemoteCommandService` 记录执行回执，并向活动流订阅者广播 `session.updated` 事件。
- 通过 `encodeAgentCommand` 中的规范 JCS 摘要保证重试幂等性。

### 3. 单轮模型与思考强度覆盖
- `agent.sessions.create` 与 `agent.messages.send` 支持可选的 `model: { providerId, modelId }` 与 `reasoningEffort`。
- 桌面端在分发校验阶段（`AgentChatContextProvider.validateDispatch`）验证模型对该智能体运行时能力的兼容性。
- 覆盖项仅作用于当前轮次的执行上下文并记录在 `agent_session_message` 元数据快照中，绝不修改共享的 `agentTable` 数据库记录。

### 4. 工具审批拒绝原因
- 远程协议与桌面端 `agentHandlers.ts` 现已支持 `agent.interactions.respond` 携带 1–4096 字符的 `reason`，并标记 `reasonSource: 'user'`，作为上下文反馈给大模型。

## Alternatives considered

- 选择模型时直接通过 `AgentService.updateAgent` 修改 `agentTable`：否决。智能体跨会话共享，修改全局配置会产生副作用。
- 移动端维护独立的会话标题库：否决。桌面端是会话与历史的唯一权威来源。
- 客户端无锁更新标题：否决。依托 `RemoteCommandService` 日志可确保移动端在弱网波动下重试的幂等性。

## Acceptance criteria

- AC1 — `connection.hello` 广播 `agentSessionRenameVersion: 1` 与 `agentModelSelectionVersion: 1` 能力标记。 (verification: unit — remote-protocol 维护者，`contracts.test.ts`)
- AC2 — `agent.sessions.update` 校验会话存在与入参，更新标题并设置 `isNameManuallyEdited: true`，经 `RemoteCommandService` 去重并广播 `session.updated` 事件。 (verification: unit — remote-access 维护者，`agent.test.ts`)
- AC3 — `agent.agents.list` 查询并暴露智能体默认 `reasoningEffort` 及兼容当前运行时的 `availableModels` 和思考选项。 (verification: unit — remote-access 维护者，`agent.test.ts`)
- AC4 — `agent.sessions.create` 与 `agent.messages.send` 支持可选的单轮 `model` 与 `reasoningEffort` 覆盖，并在分发时校验兼容性。 (verification: unit — remote-access 与 stream-manager 维护者，`agent.test.ts`)
- AC5 — 单轮模型与思考强度覆盖仅记录于轮次快照与消息元数据中，不修改共享的 `agentTable` 记录。 (verification: unit — stream-manager 维护者，`agent.test.ts`)

## Risks

- 模型能力不兼容：客户端可能传入不支持工具调用的模型。防范措施：桌面端依据 `AGENT_RUNTIME_CAPABILITIES[agent.type]` 在分发前校验兼容性，不兼容则拒绝请求。
- 重命名时网络中断：客户端可能因断网未收到响应。防范措施：`RemoteCommandService` 基于 `commandId` 幂等去重，重连后可安全重放并返回已有回执。
