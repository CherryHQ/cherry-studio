# Agent Note: 五台 runner 的 CI 执行策略

Status: implemented

[English](2026-11-10-ci-runner-consolidation.md) | 中文

## Problem

完整 CI 计划会分配十二台重任务 runner。main/preload 的三个分片和 renderer 的五个分片重复准备依赖，并占用其他运行需要的并发容量。

## Decision

使用三个 Linux job：基础检查、合并的 main/preload 和 package 测试，以及 renderer 测试。macOS 和 Windows 各保留一个原生契约测试 job。成功的完整计划会分配五个重任务 job，以及三个轻量的分类和汇总 job。测试组不使用分片过滤。

安装一次依赖后，依次运行选中的 main/preload 和 package 测试组。任一组失败后，另一组仍会执行；合并 job 通过前必须校验两组计划内步骤的实际结果。依赖安装成功后，标记该 job 的 workspace 导出已准备完成，验证流程据此跳过重复的 postinstall 构建。本地未准备环境的验证和原生 SQLite 准备保留现有行为。

在分配重任务 runner 前，先在分类 job 中检查工作流语法和格式。从仓库 manifest 获取精确的格式化工具版本，不安装 workspace 依赖。计划生成或预检失败仍会让必需门禁失败。恢复现有的只读、非阻塞 CI Performance 观察工作流，测量排队、准备、执行以及取消运行的成本。

保留受影响项目选择、测试清单、worker 限制，以及 `basic-checks`、`general-test`、`render-test` 门禁。移除分片 job 名称时，同步更新门禁依赖和结果映射。

本决策仅取代[验证提案](../../proposed/process/2026-10-01-ci-and-local-validation.md)中 main/renderer 的初始分片基线。

## Alternatives considered

- 保留六台重任务 runner：分开运行 main/preload 和 package 测试，但会额外重复一次环境准备。
- 保留十二台重任务 runner：继续拆分测试，但会额外重复七次环境准备。
- 合并到四台或三台重任务 runner：能共享更多准备工作，但更多验证工作会串行执行。

## Consequences

与回滚后的配置相比，每次完整运行减少七次依赖安装和缓存恢复，保留的 job 会复用已成功完成的 workspace 准备。main 和 renderer 测试的跨机器并行度降低；合并 main 和 packages 会进一步延长该 job 的执行时间。预检通过前不会分配测试 runner。托管 CI 的耗时测量必须区分排队时间、缓存状态、准备和测试执行。

## Verification

- Regression — `scripts/__tests__/validationWorkflow.test.ts` 约束三台 Linux runner 加一台 macOS 和一台 Windows runner，确保测试组不含分片过滤、main/package 结果独立校验、预检失败被正确处理，并且仅在依赖安装成功后写入准备标记。
- Regression — `scripts/__tests__/validationPlan.test.ts` 确保已准备和未准备的 workspace 都完整执行选中的测试组，并保留原生 ABI 准备。
