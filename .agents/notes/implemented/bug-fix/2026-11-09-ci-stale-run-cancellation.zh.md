# Agent Note: 在 PR 关闭后取消过期 CI

Status: implemented

[English](2026-11-09-ci-stale-run-cancellation.md) | 中文

## Problem

PR 并发策略只有在另一个 PR 事件启动 CI 时才会替换旧运行。关闭或合并 PR 后，未完成的测试仍会继续，包括独立触发的手动全量验证。重复的手动运行也会排在先前运行之后。这些任务会与活跃 PR 争用组织的 runner 并发额度。

## Decision

[CI 工作流](../../../../.github/workflows/ci.yml) 按事件及 PR 编号或完整 ref 划分并发组。PR 运行会替换同一 PR 的旧运行，手动运行会替换同一 ref 的旧手动运行。Push 和定时全量验证保留不取消已有运行的并发组，并与手动验证隔离。

[关闭 PR 后的清理工作流](../../../../.github/workflows/ci-cancel-closed-pr.yml) 使用 `pull_request_target: closed`，只授予 Actions 写入和 PR 读取权限。它执行内联 GitHub API 调用，不检出仓库代码。它只请求取消与已关闭 PR 的 head 仓库和分支匹配、创建于 PR 创建至关闭期间、尚未完成的 `ci.yml` PR 运行或功能分支手动运行。取消前会检查当前状态；同一 head 仍有其他开放 PR 时保留该分支的运行。只有确认运行已完成后，才接受取消操作返回的冲突。

## Alternatives considered

- 取消所有旧 push 可能导致漏检：下一次 push 只选择自身 before/after 范围内的改动，不包含已取消前序运行的改动。发布分支 push CI 还负责授权对应精确提交的构建。
- 合并 PR 与手动运行的并发组，可能用只针对 head 的全量检查替代合并结果验证，也可能用受影响检查计划取消明确请求的全量检查。
- 只按分支名称匹配，可能取消另一个 fork 的 CI。只按 SHA 取消，则无法覆盖同一 PR 分支上的旧手动运行。

## Consequences

关闭 PR 时也会清理功能分支上的手动 CI，而默认分支和 `release/v*` 分支的手动验证会保留。Push、定时、已完成及其他工作流的运行均不受影响。与开放 PR 共享的分支会保守保留。清理需要使用托管 runner，因此取消操作可能需要等待可用资源；API 接受请求并不代表目标已经停止。Head 仓库已删除时，由于无法确认其身份，会跳过清理。

工作流只读取已关闭 PR 存续期间创建的运行，并排除关闭后启动的执行尝试。状态检查观察到的后续运行和重新打开的 PR 会被保留。在最后一次状态读取与取消之间，PR 仍可能重新打开；新的 `reopened` CI 事件会创建替代运行。

## Verification

- Regression — `pnpm test:scripts scripts/__tests__/ciCancellation.test.ts scripts/__tests__/validationWorkflow.test.ts`，使用隔离的 Git 配置：取消、事件/ref 隔离、fork 身份、受保护分支、重新打开、共享分支、完成竞态和现有受影响验证门禁均通过。
- Regression — `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml .github/workflows/ci-cancel-closed-pr.yml`：工作流语法、表达式和权限校验通过。
