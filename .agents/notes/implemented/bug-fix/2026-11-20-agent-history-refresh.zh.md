# Agent Note: 按 ID 刷新变更的智能体消息

Status: implemented

[English](2026-11-20-agent-history-refresh.md) | 中文

## Problem

一次消息投影通知会刷新智能体历史中所有已加载的页。主进程每次读取一页，都会反序列化已保存的消息正文，其中包括大型工具输出。选中分支也依赖这些读取发现部分新建的占位消息。

## Decision

流式回合的占位消息提交后，发布成员变更通知。投影通知提供 ID 时，通过限定到当前会话的单条读取接口，只重读已加载且受影响的消息。沿用列表的工具输出延迟加载投影和主进程判断的历史操作可用性，保留缓存中的兄弟节点分组。保存助手消息的检查点可能改变直接后续用户消息的编辑资格时，将该用户消息纳入通知。

追加成员的 ID 已知时，读取首页直到原有游标边界。确认原首页仍构成新首页的末尾、且下一页游标相同后，复用较旧的页。通知缺少 ID，或首页无法证明后续分支保持一致时，刷新游标链。

## Alternatives considered

- 重新读取变更所在的页，仍会反序列化同页其他消息的正文。
- 将占位消息直接作为缓存数据，可能展示主进程未选中的分支。

## Consequences

带 ID 的内容变更保持已加载的分页边界。追加消息可以在列表上限内扩充首页。分支切换、缺少游标提示的删除以及显式历史刷新仍可重建已加载的游标链。

## Verification

- Regression — `useAgentSessionParts.revalidation.test.ts` 使用真实 SWR 缓存，验证单条请求、追加时复用旧页、并发分页和选中分支替换。
- Regression — `agentSessionMessages.test.ts` 和 `AgentSessionMessageService.test.ts` 覆盖带投影的单条读取、工具输出延迟加载和编辑资格失效通知。
- Regression — Electron 开发版预置 180 条历史消息，使用本地模拟模型。三轮 Pi Durable 对话各完成一次子智能体和主智能体的流式回复。列表读取从 36 次降到 3 次，`listSessionMessages` 路径的采样分配从 479 MiB 降到 45 MiB。另一组测试六次更新同一条已加载消息，用六次单条读取取代了 24 次列表读取。
