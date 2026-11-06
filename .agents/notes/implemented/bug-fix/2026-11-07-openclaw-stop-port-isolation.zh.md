# Agent Note：OpenClaw 停止操作限定到配置的网关端口

Status: implemented

[English](2026-11-07-openclaw-stop-port-isolation.md) | 中文

## 问题

POSIX 上的 OpenClaw 停止操作使用 `pkill -9 openclaw`，会终止其他网关。Windows 按端口子串筛选 netstat，停止 1879 时也可能终止 18790 的监听者。E2E 清理不能停止开发者的独立网关。

## 决策

仅查找配置端口上的 TCP 监听者。Windows 解析本地端点和 LISTENING 状态；POSIX 使用 lsof 的 TCP 监听过滤。对正数 PID 去重并排除当前进程，保留原有端口停止验证。

## 考虑过的替代方案

- 全局按进程名终止会跨越实例边界。
- 只终止本次创建的子进程无法停止通过配置端口管理的既有网关。
- 端口前缀匹配可能选中另一个网关。

## 后果

停止操作仍管理配置的网关端点，包括外部启动的网关，但不会影响其他端口的监听者。无需迁移配置或存储数据。

## 验证

- Regression — 用模拟的操作系统监听表分别表示 1879 和 18790 上的网关；两个平台停止 1879 后，18790 都必须保持存活。两个用例修复前均失败，测试中的进程终止均为模拟。
- Regression — OpenClawService 的 149 项测试全部通过。真实网关启动/停止，以及 CODE-03 和 MP-97 联合复测待完成。
