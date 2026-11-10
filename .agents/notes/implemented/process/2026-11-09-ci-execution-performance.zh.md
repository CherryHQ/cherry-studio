# Agent Note: CI 执行性能

Status: implemented

[English](2026-11-09-ci-execution-performance.md) | 中文

## Problem

仓库、类型、lint 和语言检查串行执行，延长了 CI 耗时。依赖安装已经构建 workspace 导出，但验证又构建一次。即使禁用取消，共享的 push 并发组仍可能替换排队中的提交。

## Decision

四类检查独立在 Ubuntu 上执行，保留必需的 basic 汇总检查，异常时拒绝通过。保留全部已有检查和测试项目。renderer 使用八个分片，main 保留三个分片，Windows 使用两个分片，macOS 使用一个 runner。使用 setup-node 的 pnpm 缓存，不增加构建产物缓存。

只有 PR 使用共享且可取消的并发组。push、定时和手动运行使用唯一运行 ID，并执行完整验证。纯文档 PR 保留文档检查和稳定的必需检查，不执行无关测试；运行时 Markdown 仍受验证覆盖。

CI 安装成功后，标记当前 runner 的 workspace 导出已准备。验证只跳过重复的 postinstall 构建；本地验证仍构建导出，原生 ABI 准备保持不变。

本决策部分替代[验证提案](../../proposed/process/2026-10-01-ci-and-local-validation.md)中的执行策略，保留其覆盖和计划决策。用户于 2026-11-09 明确豁免本次任务的 Spec 审批。

## Alternatives considered

在 workflow 层排除文档会使必需检查一直等待。跳过测试或原生契约会损失覆盖。增加缓存会与约 10 GiB 的依赖缓存竞争容量。保留串行检查能减少安装次数，但会增加延迟。

## Consequences

增加 Ubuntu runner，以累计机器时间换取更短的执行路径。setup-node 的新缓存键需要首次填充；必须区分冷缓存与热缓存测量。并发基准运行会干扰排队时间，因此分别报告排队、准备和执行耗时。

## Verification

- Regression — 验证工作流和计划测试拒绝缺失、失败、取消或意外跳过的计划内检查；纯文档 PR 不运行无关测试，push 保留完整清单。
- Regression — 并发测试确保不同 push 运行使用不同组，同一 PR 的连续运行共享可取消的组。
- Regression — 准备测试覆盖已安装的 CI 工作区和未准备的本地工作区，不遗漏验证命令。
- Local builds — 在消除 CI 重复准备之前，连续两次完整构建均成功，分别耗时 38.43 秒和 35.18 秒；这不代表增量构建提速。
