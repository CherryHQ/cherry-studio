# Agent Note: 按字节限制 Claude 归档传输

Status: implemented

[English](2026-11-14-claude-archive-transfer.md) | 中文

## Problem

Claude 会话恢复时通过一次结构化克隆将整个原生归档从 worker 传到主进程。原始导入记录重复携带了 SDK 所选历史中已有的正文。传输完成后，归档读取和观察快照又在主线程序列化大段历史。Electron 45.2.2 的隔离复现使用约 448 MiB、200 条消息的历史，主进程 RSS 达到数 GiB，并在首次订阅时耗尽 V8 堆。

## Decision

[归档 worker](../../../../packages/agent-runtime-claude-code/src/archiveWorker.mjs) 转移已序列化的缓冲区，每帧合计最多承载 16 MiB 正文。[接收端](../../../../packages/agent-runtime-claude-code/src/archive.ts) 追加当前帧后确认，worker 收到确认才发送下一帧。接收端在收到结束标记后交付完整归档。worker 仅传输恢复所需的原始记录字段，并逐个读取子会话。SDK 继续选择按时间排序的消息正文。接收端保留空子会话、消息顺序和现有缺失会话行为。

Claude 归档和观察快照复制对象与数组容器，共享不可变字符串。调用方可以修改副本，归档所有者和其他观察者的状态仍彼此独立。其他适配器沿用共享 feed 的默认复制行为。

## Alternatives considered

- 按记录数分块。即使一帧只有一条消息，正文也可能很大。
- 同时传输原始正文和归一化正文。恢复只需原始元数据，包括撤回、中止或拒绝状态以及子会话的父级。
- 向调用方共享归档对象。调用方可借此修改所有者的状态。

## Consequences

单条归一化记录序列化后超过 16 MiB 时，恢复沿现有错误路径返回，并记录传输超限。原生文件保持完整，接收端仅交付完整归档。分块限制的是传输期间的临时缓冲区。SDK 读取与保留的历史仍随历史体积增长，进程总 RSS 也受分配器影响。

## Verification

- Regression — `pnpm test:agent-runtime-claude-code packages/agent-runtime-claude-code/tests/archive.test.ts` 通过真实 SDK 和 worker 覆盖跨块 UTF-8 历史、确认背压、空子会话、副本隔离及单条超限后的重试。
- Regression — macOS 上的 Electron 45.2.2 主进程通过隔离测试入口恢复 469,588,289 字节的原生历史，读取已提交归档并完成首次订阅。修复前在订阅阶段触发 V8 OOM，修复后完成全部步骤，200 条正文的 SHA-256 一致。本次验证范围为 macOS 合成数据。
