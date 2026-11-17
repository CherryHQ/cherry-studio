# Agent Note: 会话指标栏

Status: proposed

[English](2026-11-12-session-metrics-bar.md) | 中文

## 问题

Agent 聊天界面只按消息显示 token 和耗时数据，无法看到会话级别的轮数、工具调用步数、输入 token 和缓存命中率，因此难以判断会话成本，也难以决定何时开启新会话。跟踪 issue：CherryHQ/cherry-studio#19707。

## 方案

在 Agent 输入框上方增加一个紧凑的指标栏，显示轮数、工具调用步数、输入 token、缓存命中率、首 token 时间和每秒 token 数。默认显示，收起时为一行；点击可展开查看详情。设置中提供开关可隐藏。

所有数值都在渲染进程中由现有的逐消息统计数据计算得出，不涉及数据库结构、IPC 或持久化改动。

- 缓存命中率 = sum(cacheReadTokens) / sum(inputTokens)。任一总和不可用时显示「—」。
- 轮数 = 会话中已完成的助手轮次。工具调用步数 = 这些轮次中的工具调用部分。
- 由于「LLM 墙钟时间」的定义不明确，本方案不包含该指标。

## 考虑过的替代方案

- 在主进程聚合并通过 IPC 暴露：为渲染进程已有的数据增加一次往返和服务边界。未采用。
- 持久化会话计数器：需要迁移和写入路径改动，而这些值可以重新计算。未采用。

## 验收标准

- AC1 — 对于一个测试会话，指标栏显示的轮数、工具调用步数、输入 token、缓存命中率、首 token 时间和每秒 token 数与逐消息统计的总和一致。 (verification: renderer component tests)
- AC2 — 关闭设置后指标栏隐藏；重新开启后再次显示。 (verification: renderer component tests)
- AC3 — 对测试会话，缓存命中率等于 sum(cacheReadTokens) / sum(inputTokens)。 (verification: renderer component tests)
- AC4 — 一轮对话完成后指标栏更新。 (verification: renderer component tests)
- AC5 — 缺少源数据的指标显示「—」，而不是 0。 (verification: renderer component tests)

## 风险

- 除 Claude Code 外的提供商可能不返回缓存或耗时字段，因此部分指标常会显示「—」。
- 按每次 API 调用累加输入 token 会重复计算上下文。这与 issue 所要求的计费输入总量一致，但需要明确标注。
- 长会话下每次消息更新都重算可能影响渲染性能。应按消息列表引用做记忆化。
