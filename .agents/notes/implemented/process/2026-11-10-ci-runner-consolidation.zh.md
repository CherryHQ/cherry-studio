# Agent Note: 八台 runner 的 CI 执行策略

Status: implemented

[English](2026-11-10-ci-runner-consolidation.md) | 中文

## Problem

完整 CI 计划会分配十二台重任务 runner。main/preload 的三个分片和 renderer 的五个分片重复准备依赖，并占用其他运行需要的并发容量。五台方案的一轮测试中，合并的 main/packages 耗时 12 分 21 秒；更早一轮完整测试中，未分片的 renderer 耗时 23 分 53 秒。当前目标是在节约二十台共享 runner 容量的同时，将执行时间控制在约十分钟。

## Decision

使用六个 Linux job：基础检查、main/preload 测试、package 测试，以及三个 renderer 分片。macOS 和 Windows 各保留一个原生契约测试 job。成功的完整计划会分配八个重任务 job，以及三个轻量的分类和汇总 job。main/preload 和 packages 不分片；renderer 使用 Vitest 内置的三等分片，并关闭 fail-fast。

独立运行选中的 main/preload 和 package 测试组，彼此无需等待，也不会因另一组失败而被跳过。依赖安装成功后，标记该 job 的 workspace 导出已准备完成，验证流程据此跳过重复的 postinstall 构建。本地未准备环境的验证和原生 SQLite 准备保留现有行为。

在分配重任务 runner 前，先在分类 job 中检查工作流语法和格式。从仓库 manifest 获取精确的格式化工具版本，不安装 workspace 依赖。计划生成或预检失败仍会让必需门禁失败。恢复现有的只读、非阻塞 CI Performance 观察工作流，测量排队、准备、执行以及取消运行的成本。

保留受影响项目选择、测试清单、worker 限制，以及 `basic-checks`、`general-test`、`render-test` 门禁。调整执行布局时，同步更新门禁依赖和结果映射。

本决策仅取代[验证提案](../../proposed/process/2026-10-01-ci-and-local-validation.md)中 main/renderer 的初始分片基线。

## Alternatives considered

- 保留五台重任务 runner：环境准备最少，但 main/packages 和 renderer 都超过执行时间目标。
- 使用七台重任务 runner，将 renderer 分成两片：根据未分片的实测耗时，预计难以为十分钟目标留足余量。
- 保留十二台重任务 runner：单个测试 job 更短，但会额外重复四次环境准备。

## Consequences

与回滚后的配置相比，每次完整运行减少四次依赖安装和缓存恢复，保留的 job 会复用已成功完成的 workspace 准备。二十台 runner 的共享池能同时容纳两组八台的完整测试布局，并剩余四个名额。预检通过前不会分配测试 runner。renderer 三分片是用于验证目标的初始分配，不代表已实测保证十分钟。托管 CI 的耗时测量必须区分排队时间、缓存状态、准备和测试执行。

## Verification

- Regression — `scripts/__tests__/validationWorkflow.test.ts` 约束六台 Linux runner 加一台 macOS 和一台 Windows runner，确保 main/package 测试组完整运行、三个 renderer 分片均被覆盖、汇总门禁正确处理失败、预检失败被正确处理，并且仅在依赖安装成功后写入准备标记。
- Regression — `scripts/__tests__/validationPlan.test.ts` 确保已准备和未准备的 workspace 都完整执行选中的测试组，并保留原生 ABI 准备。
