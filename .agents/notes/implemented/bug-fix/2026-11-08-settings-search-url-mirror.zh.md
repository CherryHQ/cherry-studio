# Agent Note: 在 URL 镜像期间保留最新设置搜索输入

Status: implemented

[English](2026-11-08-settings-search-url-mirror.md) | 中文

## Problem

设置搜索在防抖后将输入镜像到 URL。如果用户在较早的导航等待完成时继续输入，旧查询到达后可能覆盖输入框和实时结果。托管 smoke trace 记录了没有新输入时，`proxy` 回退为 `prox` 或 `pr`。

## Decision

在路由历史状态中为每次 URL 镜像标记组件归属和版本。首次确认自身镜像时，只更新已观察的 URL，不替换较新的输入。再次访问已确认的历史条目仍视为外部导航，并恢复其查询。防抖输入、Enter 和清空使用同一归属规则。

## Alternatives considered

- 减慢 E2E 输入会掩盖真实用户也可能遇到的竞态。
- 仅比较查询字符串无法区分旧镜像与外部导航。
- 编辑期间忽略所有 URL 更新会破坏历史记录和深链接同步。

## Consequences

URL 镜像追赶输入时，输入框和实时结果保持最新。历史记录和深链接仍会恢复其查询。标记只保留在本地路由历史状态中，不增加 URL 参数或持久化偏好。

## Verification

- 回归——延迟导航测试在修复前得到 `prox` 而非 `proxy`；修复后保留输入、实时查询和下一次 URL 镜像。
- 回归——SettingsSearchBox、SettingsSearchDomIds 和 SettingsPage 共 36 项 renderer 检查通过，包含外部查询更新和再次访问已确认镜像。托管 smoke 验收仍需完整 workflow 复测。
