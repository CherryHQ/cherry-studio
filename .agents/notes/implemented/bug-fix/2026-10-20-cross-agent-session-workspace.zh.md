# Agent Note: 跨 Agent 创建 Session 时延续目标 Agent 的工作区

Status: implemented

[English](2026-10-20-cross-agent-session-workspace.md) | 中文

## 问题

带 `target_agent_id` 的 `session_create` 会复制调用方的工作区。人类打开该 Agent 时会延续它自己的上一个工作区，因此 Agent 创建的 Session 可能落进无关目录。工作区绑定在首条消息后永久锁定，用户之后无法纠正。

## 决策

跨 Agent 创建时，解析目标 Agent 最近活跃的 Session 并复用其工作区：用户工作区按 id 复用；该 Session 没有项目时新建 system 工作区。同 Agent 创建仍沿用调用方工作区；目标 Agent 没有任何 Session 时回退到调用方工作区。这是 renderer 中 `resolveCreateWorkspaceSource` 同 Agent 继承规则在 Agent 侧的对应实现。

## 考虑过的替代方案

- 始终保留调用方工作区：否决，这与人类在同一 Agent 下的行为矛盾，且会把委托出的 Session 困在无关目录。
- 始终使用 system 工作区：否决，面向文件的委托将没有文件可用。
- 现在就增加显式工作区参数：暂缓；#19307 的 Agent 默认目录合入后应提供该优先级。

## 后果

解析只读取现有 Session 行，无 schema 或迁移变更。目标 Agent 的最近 Session 即使只是空占位，也会以它为准。若记住的用户工作区已被删除，创建会像人类 Session 一样失败，而不是静默选择其他目录。

## 验证

- Regression — `pnpm test:main src/main/ai/mcp/servers/__tests__/cherryAutonomyTools.test.ts`：跨 Agent 创建使用目标 Agent 的工作区而非调用方；目标为 system 工作区时新建 system 工作区；目标 Agent 无 Session 时保留调用方回退。
