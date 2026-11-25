# Agent Note: Pi 子 agent 默认权限

Status: implemented

[English](2026-11-10-pi-subagent-permissions.md) | 中文

## 问题

Pi 和 Pi Durable 的子线程继承根会话权限，导致根会话使用默认模式时，委派的写入操作等待审批。

## 决策

桌面端共用的行为宿主为子线程提供 `bypassPermissions`。根线程继续读取 agent 的实时权限模式。两个 runtime 使用相同的线程身份边界，恢复的子线程也适用。

## 考虑过的替代方案

- 继承根权限可以保留子线程的交互审批，但无法满足所要求的子线程默认自主执行行为。
- 修改全局行为默认值会影响桌面 Pi 集成之外的宿主。

## 影响

即使根会话要求审批，子线程工具也可以跳过普通审批执行。禁用工具、不可绕过的审批和其他强制保护仍由现有行为审批入口执行。不引入持久化设置或迁移。

## 验证

- Regression — `PiRuntimeConnection.test.ts` 和 `PiDurableRuntimeConnection.test.ts`：根会话使用默认权限时，子线程无需审批请求即可写入真实文件。
