# Agent Note: 由宿主管理的子线程驻留

Status: proposed

[English](2026-11-19-agent-child-residency.md) | 中文

## Problem

打开一个智能体会话时，Main 会挂载每个已绑定的子线程。Claude Code 的 `restoreChildren` 逐个打开已保存的子线程；Pi 和 Pi Durable 打开根快照里列出的全部子线程。每次挂载都会把完整的原生归档读进一个 `ChildThreadProjection`，并一直保留到根连接关闭。此前只有 Pi Durable 会释放已结束的子线程，而且只在当前进程内有效。

在 Electron 复现中（17 个 Claude Code 子智能体，每个读取 40 张图片），全部子线程结束后 Main 堆仍停在约 974 MB。重新打开这个空闲会话、不做任何新工作，堆也会从 94 MB 涨到 877 MB。同一负载放大后，Main 在约四分钟时因 V8 内存不足崩溃。

[运行时契约](2026-10-17-agent-runtime-contract.md)（「协调访问，但不拥有执行」）把驻留留给宿主决定。但宿主里有三份子线程挂载状态机，其中只有一份会释放。

## Proposal

- `src/main/ai/agentSession/ChildResidency.ts` 统一负责 Claude Code、Pi 和 Pi Durable 连接的子线程挂载，包括：opening、attached、releasing、closing 四种状态，合并并发打开，查看者和命令的 pin，在释放与重开之间保持不变的视图，drain 以及 close。
- 连接负责报告子线程的原生工作是否已结束。对没有被查看者或命令 pin 住的已结束子线程，residency 会 flush、释放并记录下来。「已结束」的依据按运行时分别给出：
  - Pi Durable：原生 facts 报告运行空闲且已有 run end，并且每个输入都有结果。
  - Pi：原生子任务状态为 completed、stopped 或 error，并且每个输入都有结果。后台子线程的请求仍在进行时，Pi 的子线程 activity 也可能显示为 idle。
  - Claude Code：子线程的任务 activity 为 idle。如果子线程的 context 行在本次挂载之前就已存在，那么 owner 报告没有任务状态（`unknown`）时也视为已结束，因为 Claude 的后台任务会随 CLI 进程一起结束。
- 释放时，在最后一次 flush 之后往子线程的 context 行写入 `checkpointMapping.child.settled`。关闭时，为它停止的已结束子线程同样写入该标记。重新挂载一个已 settle 的子线程时清除标记。
- 重新打开时，已 settle 的后代先被记为已释放，发现流程会跳过它们，包括各运行时的根快照和子快照，以及 Claude 的归档关系重放。Claude 只恢复未 settle 的已保存子线程，并且一次一个。已释放的子线程会在以下情况重新加载：查看者调用 `childProjection`、命令调用 `messageChild`、Pi 子线程完成或用量归属，以及 Pi 或 Pi Durable 收到 relation upsert。
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

- 父线程恢复一个已释放的 Claude 子线程时（例如通过 `SendMessage`），宿主要等到有查看者打开它才会开始观察。归档读取会重放所有关系，无法和真正的实时启动区分。子线程打开时，已保存的消息行会从归档对齐。
- 本次改动之前保存的会话里，子线程没有标记。Claude Code 和 Pi Durable 会把它们恢复一次并 settle；Pi 会像以前一样保持加载，直到它们再次完成。
- 子线程释放后原生 owner 再交付的内容，会留在原生归档里，直到子线程再次被打开。
- 原生 Claude owner 仍会持有每个子线程解析后的记录，直到根连接关闭；它读取根归档时也会解析所有子线程。复现中，实时运行结束后这部分约有 276 MB 图片，settle 后重开约 122 MB。要在那一层按线程驱逐，需要运行时契约暂缓的原生契约。
