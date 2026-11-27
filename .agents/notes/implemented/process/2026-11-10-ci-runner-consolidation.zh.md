# Agent Note: 九台 runner 的 CI 执行策略

Status: implemented

[English](2026-11-10-ci-runner-consolidation.md) | 中文

## Problem

完整 CI 计划会分配十二台重任务 runner。main/preload 的三个分片和 renderer 的五个分片重复准备依赖，并占用其他运行需要的并发容量。五台方案的一轮测试中，合并的 main/packages 耗时 12 分 21 秒；更早一轮完整测试中，未分片的 renderer 耗时 23 分 53 秒。八台方案中，未分片的 main/preload 仍超过十分钟。当前目标是在节约二十台共享 runner 容量的同时，将执行时间控制在约十分钟。

## Decision

使用七个 Linux job：基础检查、两个 main/preload 分片、package 测试，以及三个 renderer 分片。macOS 和 Windows 各保留一个原生契约测试 job。成功的完整计划会分配九个重任务 job，以及三个轻量的分类和汇总 job。packages 不分片；main/preload 和 renderer 使用 Vitest 内置分片，并关闭 fail-fast。

独立运行选中的 main/preload 和 package 测试组，彼此无需等待，也不会因另一组失败而被跳过。依赖安装成功后，标记该 job 的 workspace 导出已准备完成，验证流程据此跳过重复的 postinstall 构建。本地未准备环境的验证和原生 SQLite 准备保留现有行为。

在分配重任务 runner 前，先在分类 job 中检查工作流语法和格式。从仓库 manifest 获取精确的格式化工具版本，不安装 workspace 依赖。计划生成或预检失败仍会让必需门禁失败。保留只读耗时采集脚本供按需分析；CI Performance 的自动执行通过仓库 Actions 设置停用。

PR 和 `main` 推送执行计划选中的静态检查和仓库校验。Nightly CI 在北京时间 02:17 执行全量计划。手动运行也执行全量计划。每次推送到 `release/v*` 都执行全量计划。发布门禁要求对应发布分支及提交的推送 CI 通过。保留测试清单、worker 限制，以及 `basic-checks`、`general-test`、`render-test` 门禁。所有测试任务均跳过时，测试门禁仍验证计划。

上游仓库的定时 CI 失败并发现代码回归时，使用 [Nightly CI Repair](../../../../.github/workflows/nightly-ci-repair.yml) 修复。Claude 以只读仓库权限读取准确的失败提交和对应运行尝试的日志。Claude 报告针对性检查通过，且 `main` 仍指向失败的提交时，由独立任务发布补丁。发布任务拒绝修改 GitHub 自动化配置的补丁，并创建带签名提交的 PR 供审核。

将生成的文档来源索引视为文档，而不是触发全量验证的未知输入。`aiCore`、`ai-sdk-provider` 和 `web-search` 中的可移植 TypeScript 源码保留其 Linux 项目及消费者测试，同时省略原生平台 job。主进程和共享层源码、原生适配器、配置、未知输入及混合改动保留现有的原生平台选择。定时和手动全量验证始终包含两个平台。在计划和范围哈希中记录平台选择，确保执行与必需门禁一致。

本决策仅取代[验证提案](../../proposed/process/2026-10-01-ci-and-local-validation.md)中 main/renderer 的初始分片基线。

## Alternatives considered

- 保留五台或八台重任务 runner：环境准备较少，但合并的 main/packages、renderer 或未分片的 main/preload 仍超过执行时间目标。
- 使用七台重任务 runner，将 renderer 分成两片：根据未分片的实测耗时，预计难以为十分钟目标留足余量。
- 保留十二台重任务 runner：单个测试 job 更短，但会额外重复三次环境准备。
- 只要 package 改动就跳过原生 job：无法区分可移植协议与文件系统或原生适配器。仅豁免已检查的三个可移植源码目录，其配置及原生消费者仍采用保守选择。

## Consequences

与回滚后的配置相比，每次完整运行减少三次依赖安装和缓存恢复，保留的 job 会复用已成功完成的 workspace 准备。二十台 runner 的共享池能同时容纳两组九台的完整测试布局，并剩余两个名额。预检通过前不会分配测试 runner。分片数量是用于验证目标的初始分配，不代表已实测保证十分钟。托管 CI 的耗时测量必须区分排队时间、缓存状态、准备和测试执行。

## Verification

- Regression — `scripts/__tests__/validationWorkflow.test.ts` 约束七台 Linux runner 加一台 macOS 和一台 Windows runner，确保 package 测试组完整运行、两个 main/preload 分片和三个 renderer 分片均被覆盖、汇总门禁正确处理失败、预检失败被正确处理，并且仅在依赖安装成功后写入准备标记。
- Regression — `scripts/__tests__/validationPlan.test.ts` 确保已准备和未准备的 workspace 都完整执行选中的测试组，并保留原生 ABI 准备。
- Regression — `scripts/__tests__/validationPlan.test.ts` 和 `scripts/__tests__/validationWorkflow.test.ts` 复现文档索引回退问题，并验证可移植改动保留 Linux 消费者覆盖，混合、原生、配置输入及全量验证要求两个平台，跳过原生 job 不能掩盖缺失的 Linux job。
- Regression — `scripts/__tests__/validationWorkflow.test.ts` 验证 PR 中较早提交的源码改动仍会触发静态检查，main 推送缺少比较基准时回退到全量静态检查，以及每次发布分支推送、Nightly 和手动运行均覆盖所有测试项目和两个原生平台。
- Regression — `scripts/__tests__/release-workflow.test.ts` 验证即使提交 SHA 相同，`main` 上的成功运行也无法满足发布门禁。
- Regression — `scripts/__tests__/validationWorkflow.test.ts` 验证修复流程的触发条件，并在临时 Git 仓库中应用补丁，确保发布任务会阻止基准过期或修改 GitHub 工作流的补丁。
