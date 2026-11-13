# Agent Note: 后台生成保留已有回复

Status: implemented

[English](2026-11-09-agent-background-reply-continuity.md) | 中文

## 问题

真实 Claude Code 后台 Bash 任务在 Main 已落盘父线程首段回答后结束。adapter 将 shell 任务排除在待返回的子任务结果之外，随后又发出缺少来源调用的唤醒事件。Main 因而新建带有 `Continued after background work` 标签的助手行，将一次用户请求拆成两条产品回复。

让所有后台 shell 都等到退出，又会令开发服务器一直占住回复。SDK 提供任务身份和 ambient 活动标记，并没有可靠的有限命令与常驻进程分类。

## 决策

运行中的 shell 命令只保留连接占用，不阻塞产品回复完成。Claude adapter 保留根线程 Bash 调用的来源，仅在收到非 ambient 完成通知后纳入该结果。它复用 SDK 已有的任务和 run 字段；子线程内部的 shell 调用不会取得根回复的归属。

Main 的后台生成始终复用已有助手消息。流仍打开时直接继续；回复已完成时，以同一消息 ID 开启新的只接收执行。准备过程保留已有正文、投影、作者快照、会话 head 和用量关联。最终落盘及重试沿用已有回复生命周期。

新输入被接纳后建立下一条产品回复边界。接纳前，原生调用归属或最后一条已投影助手消息标识旧回复，预留输入继续等待。来源缺失或混合归属不会创建新的助手身份，而是继续由已有的已接纳回复持有。没有已有产品回复的唤醒会报告诊断，不会凭空建行。原生归档仍是恢复依据。

删除后台续接标签及其翻译。后台来源元数据继续用于自动朗读资格判断。Goal 轮次仍有独立产品回复和标签。这替代了[边界所有权实现](../../proposed/simplification/2026-11-05-agent-runtime-boundary-ownership.md)记录的独立后台回复兜底路径。

## 已考虑的替代方案

- 等待所有 shell 进程：服务器或 watcher 可能让本已完成的回复永远无法结清。
- 根据命令文本或耗时识别常驻命令：两者都不能证明产品完成状态或回复归属。
- 保留额外行，只隐藏标签：持久化、回复身份和用量仍然分散。
- 增加任务或回复 manager：已有原生调用来源、根投影和回复状态已经能够提供所需归属。

## 影响

命令执行保留原生前台／后台策略。已完成产品回复可以接收新一次执行，不再提交用户输入或增加助手行。更新旧回复不会切换会话 head。原生来源不确定时，不再以独立后台行作为兜底。没有增加 SDK patch、依赖升级或 migration。

## 验证

- Regression — `control.test.ts`：根线程后台 Bash 完成后，无论唤醒首先出现 user 还是 assistant 帧，都携带原调用；运行中的常驻命令仍不产生待返回的产品结果。
- Regression — `AgentSessionRuntimeService.handoff.test.ts`：已完成或仍在落盘的回复保留消息 ID、旧正文及幂等用量，不重发输入；新输入接纳前后的通知保留两条用户回复边界，不增加第三条助手行。
- Regression — `MessageHeader.test.tsx`：后台元数据不展示续接标签，Goal 轮次标签仍可见。

- Regression — Claude Code 与 LongCat-2.5 的真实模型 Electron 验收：后台 Bash 和子智能体完成后各保留一条助手行；第二条用户输入被接纳后保留两条回复，不增加第三条续接。已核对界面过程历史、重开后的 API／SQLite 正文及持久化用量关联，没有注入 SDK 事件。

新增的 shell 来源与持久化回复用例在修复前失败。SDK fixture 和 Main SQLite 回归与真实模型 Electron 验收分别记录。
