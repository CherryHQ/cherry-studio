# Agent Note: 为较慢的 OpenClaw 网关冷启动留出时间

Status: implemented

[English](2026-11-27-openclaw-cold-start.md) | 中文

## 问题

在 [macOS 定时回归](https://github.com/CherryHQ/cherry-studio/actions/runs/45886302981/job/140140326717)中，Cherry Studio 的 30 秒健康检查到期时，OpenClaw 仍在启动。应用报告启动失败，未打开控制台。

## 决策

新启动网关的就绪轮询预算延长至 60 秒。现有健康端点报告网关已就绪后，启动才会成功。进程提前退出时，下一次轮询仍会立即报错。

## 考虑过的替代方案

- 延长 Playwright 超时仍会触发应用自己的启动期限。
- 进程一创建就打开控制台，可能会展示服务尚不可用的页面。

## 影响

进程仍在运行但健康检查未通过时，启动失败可能需要更长时间才能报告。macOS 和 Windows 使用相同的健康检查。

## 验证

- Regression — OpenClaw 服务测试通过 169 项，包含网关在 35 秒后通过健康检查并启动成功的场景。CODE-03 检查已安装网关的启动、控制台和停止流程。
