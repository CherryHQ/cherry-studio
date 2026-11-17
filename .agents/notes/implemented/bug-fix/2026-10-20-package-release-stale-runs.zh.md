# Agent Note: 跳过过期的包发布任务

Status: implemented

[English](2026-10-20-package-release-stale-runs.md) | 中文

## 问题

排队中的包发布任务可能仍保留已被合并的版本 PR 消费掉的 changeset。10 月 20 日，基于旧提交的任务在 #22032 合并后，通过 #22033 再次生成 `remote-transport@0.2.4`；另一个任务在 #22033 合并后，通过 #22034 再次生成 `file-preview@0.1.3`。#22034 的最终合并没有改变任何文件。

## 决策

[包发布工作流](../../../../.github/workflows/release-packages.yml) 显式检出触发事件的 SHA。在运行 Changesets 前，立即读取远端 `main` 的当前引用并与检出的提交比较。不一致时，跳过版本 PR 生成和 npm 发布；远端查询失败时，任务失败，不放行这两项操作。工作流保持串行执行并禁用取消，避免新推送中断正在进行的 npm 发布。

## 考虑过的替代方案

- 仅检出最新 `main` 不够：Changesets Action v2 会将版本分支重置到事件 SHA，并将该 SHA 用作 API 提交的基线。这还可能导致实际发布的代码与构建和测试的代码不同。
- 取消正在执行的发布任务，可能在仅部分包发布成功后中断 npm 发布。
- 只有串行执行而没有时效检查时，维护者合并版本 PR 后，排队任务的事件提交仍会过期。

## 影响

检查在构建和测试后进行，不替换已验证的 checkout。下一次符合条件的推送，或在 `main` 上新发起的手动 `Release Packages` 任务，会处理当前变更。如果推送不匹配工作流的路径过滤条件，旧任务可能过期且没有后续任务；此时应新发起一次手动任务。重新运行旧事件仍使用原 SHA，因此仍会被判定过期。

检查不是对 `main` 的原子锁：检查通过后、Action 执行期间，维护者仍可能合并提交。本修复覆盖进入 Action 前就已过期的任务，不保证消除剩余的时间窗口，也不协调人工合并与 Action 执行。

## 验证

- Regression — `pnpm test:scripts scripts/__tests__/package-release-freshness.test.ts scripts/__tests__/changeset-policy.test.ts scripts/__tests__/release-workflow.test.ts`：使用真实本地 Git 仓库，验证 changeset 被消费后拦截旧 checkout、放行当前 checkout、远端不可用或引用缺失时不放行，以及工作流的 Action 门禁和不取消发布的并发契约。
