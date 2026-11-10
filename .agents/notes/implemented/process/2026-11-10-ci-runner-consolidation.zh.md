# Agent Note: 六台 runner 的 CI 执行策略

Status: implemented

[English](2026-11-10-ci-runner-consolidation.md) | 中文

## Problem

完整 CI 计划会分配十二台重任务 runner。main/preload 的三个分片和 renderer 的五个分片重复准备依赖，并占用其他运行需要的并发容量。

## Decision

选中的 main/preload 和 renderer 测试组各自在一个 Linux job 中完整运行，不使用分片过滤。基础检查和 package 测试各保留一个 Linux job；macOS 和 Windows 各保留一个原生契约测试 job。成功的完整计划会分配六个重任务 job，以及三个轻量的分类和汇总 job。

保留受影响项目选择、测试清单、worker 限制，以及 `basic-checks`、`general-test`、`render-test` 门禁。移除分片 job 名称时，同步更新门禁依赖和结果映射。

本决策仅取代[验证提案](../../proposed/process/2026-10-01-ci-and-local-validation.md)中 main/renderer 的初始分片基线。

## Alternatives considered

- 保留十二台重任务 runner：继续拆分测试，但会额外重复六次环境准备。
- 合并到四台或三台重任务 runner：能共享更多准备工作，但更多验证工作会串行执行。

## Consequences

每次完整运行减少六次依赖安装和缓存恢复。main 和 renderer 测试的跨机器并行度降低，因此总耗时可能增加。这一配置尚未经过托管 CI 的耗时测量。

## Verification

- Regression — `scripts/__tests__/validationWorkflow.test.ts` 约束四台 Linux runner 加一台 macOS 和一台 Windows runner，确保 main/renderer 命令不含分片过滤，并拒绝计划内工作失败、取消、缺失或意外跳过。
- Regression — `scripts/__tests__/validationPlan.test.ts` 覆盖受影响项目选择和分组执行，不依赖 CI 分片方式。
