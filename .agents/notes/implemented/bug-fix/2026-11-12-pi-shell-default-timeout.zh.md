# Agent Note: 为 Pi shell 命令提供默认时限

Status: implemented

[English](2026-11-12-pi-shell-default-timeout.md) | 中文

## Problem

Pi shell 命令未指定超时时间时可能无限占用回合。脚本即使已经写出产物，仍可能因未关闭的连接或子进程而无法退出。

## Decision

桌面 Pi 和 Pi Durable 的 Bash 和 PowerShell 工具在调用未指定超时时间时使用 120 秒。超时校验、进程树终止、部分输出和错误报告仍由原生 SDK 负责。显式时限保持不变，包括有意执行长任务时指定的更长时限。工具 schema 和描述均说明默认值。

## Alternatives considered

- 另加看门狗会重复原生取消逻辑和进程所有权。
- 仅因命令没有输出就终止它，会打断正常的静默任务。
- 修改生成的用户脚本无法保护下一条命令。

## Consequences

省略时限的命令不再无限等待。显式指定更长时限的命令仍可等待更久。每个运行时将终止操作交给各自的原生执行所有者。不新增设置、重试、后台执行或命令黑名单。

## Verification

- Regression — `src/main/ai/runtime/pi/piShellTimeout.test.ts`：带有未结束子进程的真实 shell 超时后子进程退出；显式更长时限允许正常完成；短时限和无效时限保持原生行为。

- Regression — `src/main/ai/runtime/piDurable/durableShellTimeout.test.ts`：真实 Durable Node 执行环境终止挂起的 shell 子进程，同时保留显式时限和成功输出。
