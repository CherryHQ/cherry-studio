# Agent Note：Telegram 论坛话题 Agent 绑定

Status: proposed

[English](2026-11-11-telegram-topic-agent-binding.md) | 中文

## Problem

一个 Telegram 渠道只绑定一个 Agent。开启了论坛话题的超级群组会把所有话题都交给同一个 Agent，因此一个家庭或团队如果希望"市场""调研""烹饪"各用一个话题，就只能为每个工作流各建一个超级群组和一个机器人。所有话题还共享同一段对话历史，不相关的提示词会相互干扰上下文。

## Proposal

Telegram 渠道保持一个连接和一个所属 Agent。论坛话题可以映射到另一个 Agent，由该 Agent 回复话题中的消息。

### 配置

- Telegram 渠道配置新增 `topic_agents`：从论坛 thread id（数字形式的 `message_thread_id`）到 agent id 的映射。该字段可选，默认为空，因此现有渠道行为不变，但会出现下文所述的按话题拆分历史。
- 消息分发时从渠道记录中读取该映射，因此修改后无需重连机器人即可生效。

### 分发

- 入站的 Telegram 消息和命令携带 thread id。每个论坛话题拥有独立的对话（`chatId:threadId`），同一超级群组中的不同话题不会共享会话历史。
- Handler 按消息解析应答的 Agent。映射过的话题使用其 Agent；未映射的话题，或映射的 Agent 不存在或未激活，则使用渠道 Agent，并记录一条警告日志。
- 话题消息的回复、输入中状态和流式草稿都发送到该话题的 thread 中。
- 会话归属仍按应答 Agent 校验，因此已持久化、属于其他话题 Agent 的会话会被替换，而不是复用。

### 命令与界面

- `/topics` 在发送命令的话题中回复已配置的话题与 Agent 对应关系；若未配置，则说明尚未配置。
- Telegram 渠道表单新增"话题 Agent"区域：数字形式的 thread id、Agent 选择器、添加与删除。保存前会拒绝非数字的 thread id 和重复的 id。

## Alternatives considered

- **让一个适配器服务多个 Agent。** 已拒绝。运行时归属、状态上报和 reconcile 都以渠道所属 Agent 为键，这会为按消息路由的改动重写连接生命周期。
- **每个工作流一个渠道（当前的变通方案）。** 不作为目标。它需要为每个工作流一个机器人和一个超级群组，正是本次改动要消除的运维负担。
- **通过 `getUpdates` 或持久化的话题注册表发现话题。** 暂缓。Telegram 没有列出论坛话题的机器人 API，发现功能需要持久化状态和迁移。MVP 由用户提供 thread id，可从话题链接中读取。
- **根据话题名称自动创建 Agent。** 已拒绝，超出范围。
- **超出 Agent 选择的话题级访问控制。** 已拒绝，超出范围。渠道权限和工作区仍然适用。

## Acceptance criteria

- AC1 — 在 `topic_agents` 中已映射的论坛话题里发送的消息由映射的 Agent 回复；未映射的话题或话题之外的消息由渠道 Agent 回复。（verification: unit；owner: channel message handler）
- AC2 — 同一超级群组中不同话题的消息拥有各自独立的对话，它们的会话与历史互不共享状态。（verification: unit；owner: Telegram adapter）
- AC3 — 对话题消息的回复通过 `message_thread_id` 发送到该话题的 thread 中；话题之外的消息发送时不带 thread id。（verification: unit；owner: Telegram adapter）
- AC4 — 当映射的话题 Agent 不存在或未激活时，消息由渠道 Agent 回复，并记录一条警告日志。（verification: unit；owner: channel message handler）
- AC5 — `/topics` 在发送命令的话题中回复，列出每个已映射的 thread id 及其 Agent 名称；若未配置，则说明尚未配置话题 Agent。（verification: unit；owner: channel message handler）
- AC6 — Telegram 渠道表单可添加和删除话题 Agent 映射，拒绝非数字的 thread id 与重复的 id，并将映射保存为 `topic_agents`。（verification: renderer；owner: channel settings UI）

## Risks

- **现有的论坛群组会拆分历史。** 此前超级群组中的所有话题共享一段对话。改动之后，每个话题都有自己的对话，包括未映射的话题。依赖共享历史的用户会在下一条消息时看到历史被拆分。
- **General 话题未做特殊处理。** 取决于 Telegram 客户端，General 中的消息可能不带 thread id，或带 thread id 1。为 General 配置映射前，需先用真实消息流量验证。
- **Agent 主动发送的文件不感知话题。** `sendFile` 没有回复选项，因此为话题对话发送的文件会落在 General 话题中。修复它会改动文件发送路径，留待后续处理。
- **`/topics` 不在 `/help` 中。** 斜杠命令列表与 Discord 的命令注册共用，因此目前仅限 Telegram 的命令不列入其中。
- **Handler 按 Telegram 渠道类型收窄。** 话题路由直接从 Telegram 配置读取 `topic_agents`。其他新增话题能力的平台需要将此查找泛化，留待之后的改动。
