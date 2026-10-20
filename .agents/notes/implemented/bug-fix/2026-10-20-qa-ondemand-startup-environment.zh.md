# Agent Note: 按需 QA 的启动与环境

Status: implemented

[English](2026-10-20-qa-ondemand-startup-environment.md) | 中文

## Problem

[托管验收](https://github.com/CherryHQ/cherry-studio/issues/22069)超过了 macOS 开发模式的 60 秒启动预算。Windows 报告丢失了工作流设置的 `TZ`，可见性断言则拒绝匹配多个元素的 selector。Git Bash 的[原生进程环境过滤](https://github.com/git-for-windows/msys2-runtime/blob/main/winsup/cygwin/environ.cc)会丢弃包含 `/` 的 IANA 时区值；再增加一处工作流环境变量声明无法修复这一边界。

## Decision

[控制器](../../../../scripts/e2e/ondemand/run.ts)在 branch 和 tag 模式下统一使用 120 秒就绪预算。在生成报告或启动应用之前，将缺失的 `TZ` 默认为 `Asia/Shanghai`；显式提供的时区保持不变。现有原生进程启动链继承该环境。`expectVisible` 与 `expectText` 一致，检查首个匹配元素。

## Alternatives considered

- 未采用仅增加 branch 模式超时的方案，而是统一两种模式的预算；不新增派发输入。
- 未采用保留严格可见性 selector 并改善报错的方案，而是让断言检查首个匹配元素。操作和 `waitFor` 仍要求唯一匹配。
- 在步骤配置中重复设置 `TZ` 无法消除 Git Bash 的原生进程环境过滤。修改运行器的操作系统时区则会将修复范围扩大到控制器及其应用之外。

## Consequences

未就绪的应用现在可能等待 120 秒后以退出码 3 失败。首个 selector 匹配项被隐藏时，即使后续匹配项可见，断言仍失败。应用的实际时区仍通过测量获得；设置控制器默认值不会伪造 `requiredTimezone` 校验成功。本地验证不等同于托管 Windows/macOS 验收。

## Verification

- Regression — `pnpm test:scripts scripts/e2e/ondemand/__tests__/cli.test.ts scripts/e2e/ondemand/__tests__/steps.test.ts scripts/e2e/ondemand/__tests__/environment.test.ts scripts/e2e/ondemand/__tests__/workflow.test.ts scripts/e2e/ondemand/__tests__/report.test.ts`：22 项测试通过，覆盖缺失 `TZ` 的真实控制器子进程、保留显式时区，以及不变的时区不匹配分类。
- Regression — 真实 Chrome 页面复现了修复前的多匹配断言失败，并验证修复后的首项匹配成功、隐藏首项失败和无匹配失败。
