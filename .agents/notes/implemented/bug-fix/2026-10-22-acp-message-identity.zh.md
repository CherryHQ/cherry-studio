# Agent Note: ACP 原生消息标识

Status: implemented

[English](2026-10-22-acp-message-identity.md) | 中文

## Problem

ACP 消息片段可以携带不透明的原生消息 ID。适配器此前丢弃了该字段，即使原生 ID 不同，也会合并连续的文本片段。因此，历史记录同时丢失了原生标识和消息之间的边界。

## Decision

上报的原生消息 ID 变化时结束当前内容片段。文本和思考片段在 `providerMetadata.acp.messageId` 中保留 ID；其他 ACP 内容在 `data-acp-content.data.messageId` 中保留 ID。缺失和 null ID 表示没有归属标识，绝不继承前一个 ID。工具和内容类型的边界继续拆分片段，因此一条原生消息可以占用多个片段。

Cherry 消息 UUID 继续作为本地标识。现有 `agent_session_message.data.parts` JSON 保存原生归属信息，无需新增列或迁移。原生 ID 不作为全局去重键或重放键；加载原生历史时继续抑制内容重放。

## Alternatives considered

- 用原生 ID 替换 Cherry UUID：原生 ID 不透明、可选，且属于 Agent 的历史范围，现有引用则依赖 Cherry 标识。
- 每行新增一个原生 ID 列：一条 Cherry 助手回复可能包含多条原生消息。
- 将原生 ID 复用为流式片段 ID：一条原生消息可以跨越工具和内容类型，复用已结束的片段 ID 可能混淆不同片段。

## Consequences

未提供 ID 的 Agent 保持现有分组行为。带 ID 和不带 ID 的片段分开存放，避免错误归属。此改动保留内容顺序和历史中的原生 ID，不导入原生历史，也不额外创建 Cherry 回复行。

## Verification

- Regression — `src/main/ai/runtime/localAgent/__tests__/messageIdentity.test.ts` 驱动真实 ACP 测试进程，经过 AI SDK 流读取器和执行生产迁移的 SQLite 存储，覆盖 ID 变化与重复、缺失与 null ID、空片段、工具与富内容边界、连续轮次和历史读写。
- Electron — 受控 ACP 进程验证实际聊天持久化、页面重载、连接释放与恢复以及独立的 Cherry UUID，未出现渲染进程错误。此验证不等同于真实服务商验收。
