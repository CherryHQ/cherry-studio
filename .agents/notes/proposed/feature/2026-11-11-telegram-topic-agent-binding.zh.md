# Agent Note: 将 Telegram 论坛话题绑定到智能体

Status: proposed

[English](2026-11-11-telegram-topic-agent-binding.md) | 中文

## 问题

Telegram 渠道只绑定一个智能体。因此，包含多个话题的论坛超级群组，要么所有话题共用一个智能体，要么每个智能体都需要单独一个超级群组。回复也会忽略论坛话题：适配器从不读取 `message_thread_id`，每次发送都只指向聊天本身，话题中的消息会被回复到「General」话题。

## 提案

- 配置：新增 `topic_agents`，将 `<chatId>:<message_thread_id>` 映射到智能体 ID。它同时加入共享渠道 schema 与严格的 API schema。键包含聊天 ID，因为话题 ID 只在同一聊天内唯一。
- 入站：来自论坛话题的文本、图片、文件和命令更新会携带 `threadId`。已映射的话题还会携带自己的 `conversationId` 与 `dispatchAgentId`。未映射的话题保留该聊天的会话。
- 分发：处理器对每个事件只解析一次有效智能体，依据是 `dispatchAgentId`。目标不是 `active` 时，回退到渠道智能体并记录警告日志。
- 回复：`threadId` 通过 `SendMessageOptions` 传入 Telegram 消息发送（包括纯文本回退）、输入状态和流式草稿。`ChannelManager` 的错误回复也会携带它。
- 设置：Telegram 表单新增话题编辑器，每行是一个话题键和一个智能体。不完整或格式错误的行保留在本地，不会保存。

## 备选方案

- 像 issue 建议的那样仅用话题 ID 作为 `topic_agents` 的键。不采用：话题 ID 在不同聊天之间会冲突。
- 为每个论坛话题分配独立会话。暂不采用：会改变现有论坛渠道的历史记录。未映射的话题保留聊天会话，因此空映射保持现有行为。
- 话题发现与 `/topics` 命令。推迟：需要持久化机器人见过的话题记录。用户可通过 `/whoami` 获取聊天 ID，并从话题消息链接中获取话题 ID。
- 仅在渠道自身的智能体内分发。不采用：无法实现每个话题使用不同智能体。

## 验收标准

- AC1 — Telegram 配置 schema 接受以 `<chatId>:<threadId>` 为键的 `topic_agents`，并拒绝格式错误的键和空智能体 ID（verification: unit）
- AC2 — 已映射的论坛话题分发到其智能体，使用自己的会话，并回复到该话题（verification: unit）
- AC3 — 未映射的论坛话题保持使用渠道智能体，并回复到其话题中（verification: unit）
- AC4 — 绑定到不同智能体的两个话题不共享会话（verification: unit）
- AC5 — 绑定到非 active 智能体的话题回退到渠道智能体（verification: unit）
- AC6 — Telegram 表单可将有效话题绑定到所选智能体，并且不会保存格式错误的话题键（verification: renderer）

## 风险

- 跨智能体分发会在该渠道内运行非渠道所有者的智能体。删除智能体后，其话题绑定仍留在配置中；分发时会回退，表单不会对其作标记。
- `topic_agents` 的值在保存时不会与现有智能体比对。
- Telegram 要求每个发送方法都接受 `message_thread_id`。这一点由 typecheck 依据 grammY 类型检查，而非通过真实机器人验证。
