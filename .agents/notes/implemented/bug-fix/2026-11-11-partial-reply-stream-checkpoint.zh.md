# Agent Note: 流式中断时保留已经到达的部分回复

Status: implemented

[English](2026-11-11-partial-reply-stream-checkpoint.md) | 中文

## Problem

回复只在流结束时才被写入。如果应用崩溃、退出或窗口在流式中途关闭，下次启动会看到那条 assistant 行仍是 `pending`，并把它落定为一条空的 `error`：用户已经眼看着到达的文字没了，历史里留下一条从未产出任何内容的回复。聊天话题与 agent 会话都是这样，agent 侧还多一类 delivery-owned 轮次——它的恢复会读取一个已经把流式字段剥掉的投影。

## Decision

执行流式输出期间，`AiStreamManager` 把最新累计的消息交给 `StreamListener.onCheckpoint`，频率上限为每个 `checkpointIntervalMs`（1 秒）一次。`PersistenceListener` 转交给后端的可选 `checkpoint(parts)`，SQLite 与 agent-session 后端把它存成 `pending` 行上的 `data.streamCheckpoint`。

checkpoint 位于 `data.parts` **旁边**，绝不写进去：重连的渲染器从行的 `parts` 播种 reader，再把流缓冲叠加在上面，写进 `parts` 会让同一段文字渲染两次。它复用既有的 JSON `data` 列，因此不涉及 schema 迁移；它是 main-only 字段——所有公开读取都会剥掉它，形状只声明一次（`StreamCheckpointedData`）并配一个 `withoutStreamCheckpoint` helper，而不是在每个调用点各写一遍。

启动 reconcile（聊天走 `AiStreamManager`，agent 会话走 `AgentSessionRuntimeService` 与 `recoverSessionDeliveries`）统一通过 `interruptedReplyData` 落定每条陈旧的 `pending` 行：优先取 `streamCheckpoint` 而不是占位行里空的 parts，关闭仍在活动的 parts，追加一个带 `i18nKey: 'reply_interrupted'` 的 `data-error` 部件，并在同一次写入里丢弃 checkpoint。落定就是 checkpoint 生命的终点，所以这条规则被集中到一处：终态写重建 `data` 时不包含它；只改写状态的那种落定在同一条语句里移除它；而让行继续留在 `pending` 的写入则保留它。

checkpoint 写入是同步且高频的，因此只保留改写代价低的内容：空内容与瞬态状态部件照旧丢弃，超过 `CHECKPOINT_MAX_TOOL_OUTPUT_CHARS` 的终态 tool 输出直接丢弃，而不是像终态写那样搬到 FileManager。两张表的 FTS 触发器现在只在 `$.parts` 真正变化时才重建，因为 `searchable_text` 只由 parts 推导，而 checkpoint 写入不会碰它。

## Alternatives considered

- 每个 chunk 都写一次：等于把每个 token 变成一次数据库写入。
- 只把部分文本留在内存：崩溃或退出恰恰是它必须活下来的那个场景。
- 把部分 parts 直接写进 `data.parts`：对任何在流仍活动时从行重连的渲染器都会重复文本。
- 独立一个 `stream_checkpoint` 列：归属更干净，且可空列的 `ALTER TABLE ... ADD COLUMN` 不会重建表，但这仍是为一个所有读取方都已经在剥离的字段引入迁移。
- 在 checkpoint 时裁剪超大 tool 输出而不是丢弃：持久化信封指向 FileManager 里的 blob，而这次写入是每秒一次的同步写，无法在那里创建 blob；没有 blob 的信封会渲染出已经不存在的内容。
- 让 FTS 触发器保持原样并写入不含 parts 的数据：输出正确，但每个活动流每秒把整条消息重新分词一次。

## Consequences

被崩溃、退出或关闭标签页切断的回复现在会保留已经 checkpoint 的全部内容，并以一条中断提示结束，而不是变成空 error；最多丢失最后一秒的文字。恢复出的回复里不含超大 tool 输出。每个流式执行仍会每秒重写一次该行的 `data`，因此极长的回复每个间隔都有成正比的写入代价。main-only 字段位于公开的 `data` JSON 内，正确性依赖每一条读取、落定与复制路径都走那个共享 helper。

## Verification

- Regression — `interruptedReplyData` 优先取 checkpoint、无 checkpoint 时回退到行的 parts、丢弃该字段，并保留 parts 旁边 main 权威的键。
- Regression — 只改写状态的落定会丢弃 checkpoint，而让行留在 `pending` 的 PATCH 会保留它（聊天与 agent-session 两个服务）。
- Regression — `PersistenceListener.onCheckpoint` 在后端没有 `checkpoint` 时是 no-op、吞掉后端抛错、丢弃超大 tool 输出，并忽略属于其它 `modelId` 的执行。
- Regression — 复制一条 pending 消息不再把 checkpoint 带进已落定的副本。
- Limitation — 本次改动没有做 Electron 崩溃/重启的验收运行；启动 reconcile 由真实 SQLite 数据库上的服务级测试覆盖。
