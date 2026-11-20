# Agent Note: 从启动台访问统一网关

Status: implemented

[English](2026-11-19-launchpad-api-gateway.md) | 中文

## Problem

网关的设置入口较深且无法固定。开发者需要快捷访问控制面板，同时保留设备连接路径。

## Decision

启动台包含可通过现有侧栏快捷方式机制固定的 `api_gateway` 图块，打开 `/app/api-gateway`。页面与设置共享网关控制面板，保留设置外壳和设备连接链接。功能沿用现有偏好、命令和翻译。

## Alternatives considered

永久侧栏入口或提升设置中的入口会增加持久导航界面。复制控件容易导致行为分叉；跨页面导入设置页面违反渲染进程边界。小程序、自动固定和一次性引导会增加不必要的机制或未经用户选择改变偏好。

## Consequences

共享面板在两个入口保留网关状态、地址、端口、凭据和启停控件。标签页沿用现有导航规则。同一变更移除 `.agents/notes/proposed/feature/2026-11-19-launchpad-api-gateway.{md,zh.md,i18n.yaml}`。

## Verification

- AC1 — src/renderer/pages/launchpad/__tests__/LaunchpadPage.test.tsx: 检查网关图块缺失或目标地址错误。
- AC2 — src/renderer/components/__tests__/ApiGatewayPanel.test.tsx: 检查启停操作、地址显示和密钥遮盖。
- AC3 — tests/e2e/smoke/launchpadApiGateway.test.ts: 覆盖固定、侧栏导航及取消固定后启动台保留入口。
- AC4 — src/renderer/pages/apiGateway/__tests__/ApiGatewayPage.test.tsx: 检查停止状态面板为空或缺少启动按钮。
- AC5 — tests/e2e/smoke/launchpadApiGateway.test.ts: 覆盖设备连接链接和设置面板。
- AC6 — tests/e2e/smoke/launchpadApiGateway.test.ts: 覆盖短窄窗口中的浅色和深色界面并记录深色截图。
