# Agent Note: 由宿主管理的子线程驻留

Status: proposed

[English](2026-11-19-agent-child-residency.md) | 中文

## Problem

打开一个智能体会话时，Main 会挂载每个已绑定的子线程。Claude Code 的 `restoreChildren` 逐个打开已保存的子线程；Pi 和 Pi Durable 打开根快照里列出的全部子线程。每次挂载都会把完整的原生归档读进一个 `ChildThreadProjection`，并一直保留到根连接关闭。此前只有 Pi Durable 会释放已结束的子线程，而且只在当前进程内有效。

在 Electron 复现中（17 个 Claude Code 子智能体，每个读取 40 张图片），全部子线程结束后 Main 堆仍停在约 974 MB。重新打开这个空闲会话、不做任何新工作，堆也会从 94 MB 涨到 877 MB。同一负载放大后，Main 在约四分钟时因 V8 内存不足崩溃。

[运行时契约](2026-10-17-agent-runtime-contract.md)（「协调访问，但不拥有执行」）把驻留留给宿主决定。但宿主里有三份子线程挂载状态机，其中只有一份会释放。

## Proposal

- `src/main/ai/agentSession/ChildResidency.ts` 统一负责 Claude Code、Pi 和 Pi Durable 连接的子线程挂载，包括：opening、attached、releasing、closing 四种状态，合并并发打开，查看者和命令的 pin，在释放与重开之间保持不变的视图，drain 以及 close。
- 连接把观察到的每条 `Subagent` 关系交给 residency。子线程最新的关系报告 `work: 'idle'` 时即为已结束，这个字段由[子智能体工作状态](2026-11-19-agent-subagent-work-state.md)提案加入运行时契约。对没有被查看者、命令或已加载的嵌套子线程 pin 住的已结束子线程，residency 会 flush、释放并记录下来。
- 释放时，在最后一次 flush 之后往子线程的 context 行写入 `checkpointMapping.child.settled`。关闭时，为它停止的已结束子线程同样写入该标记。重新挂载一个已 settle 的子线程时清除标记。
- 重新打开时，已 settle 的后代先被记为已释放。关系重放会让它们保持释放，并一次一个地恢复未 settle 的空闲子线程。已释放的子线程会在以下情况重新加载：查看者调用 `childProjection`、命令调用 `messageChild`、Pi 子线程完成或用量归属，以及关系报告它正在运行。
- 不需要 schema 迁移：`checkpointMapping` 是 JSON 列，子线程投影的写入会合并进已有的子线程 checkpoint。

## Alternatives considered

- **在各运行时 adapter 内部驱逐。** 契约规定每个运行时只有一个原生 owner，未经原生验证不做单线程驱逐。重复的投影在 Main 里，所以由宿主负责这项策略。
- **保留立即恢复，挂载后马上释放。** 重新打开时仍会在峰值一次性加载全部归档，而且每次重开都要重复完整读取。
- **根据已保存的产品消息行推断是否结束。** 崩溃后消息行可能看起来已完整，而原生归档里还有更多内容。标记只会在已结束子线程真正 flush 之后写入。
- **所有运行时都只看 activity。** Pi 的后台子线程在请求进行中会报告 idle，Claude 在 `task_started` 之前会报告 unknown，两者都会把仍在运行的子线程释放掉。

## Acceptance criteria

- AC1 — Claude Code、Pi 和 Pi Durable 连接通过 `ChildResidency` 完成子线程的挂载、pin、释放、drain 和关闭（verification: unit）
- AC2 — 根连接保持打开期间，已结束且无人查看的子线程会被 flush、释放并标记 settled，已保存的消息行保留最终回答（verification: unit）
- AC3 — 重新打开时不挂载已 settle 的子线程；查看或给它发消息会带着已保存的历史重新加载，惰性挂载失败后可以重试且不产生重复的 context 行（verification: unit）
- AC4 — 运行中的子线程不会被释放；请求进行中的 Pi 后台子线程仍可停止（verification: unit）
- AC5 — 在 Electron 复现中，全部子线程结束后以及空闲会话重新打开后，不再有 `ChildThreadProjection` 驻留，Main 宿主侧不保留任何子线程内容副本（verification: Electron）

## Risks

- 本次改动之前保存的会话里，子线程没有标记。三个运行时都会把它们恢复一次并 settle。
- 子线程释放后原生 owner 再交付的内容，会留在原生归档里，直到子线程再次被打开。
- 原生 Claude owner 仍会持有每个子线程解析后的记录，直到根连接关闭；它读取根归档时也会解析所有子线程。复现中，实时运行结束后这部分约有 276 MB 图片，settle 后重开约 122 MB。要在那一层按线程驱逐，需要运行时契约暂缓的原生契约。
