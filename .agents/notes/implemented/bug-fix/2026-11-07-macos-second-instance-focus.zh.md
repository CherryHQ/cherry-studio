# Agent Note：重复启动时激活 macOS 应用

Status: implemented

[English](2026-11-07-macos-second-instance-focus.md) | 中文

## 问题

重复启动会恢复现有主窗口，但在 macOS 上原应用可能仍位于其他应用之后。仅恢复或聚焦 BrowserWindow 不会请求应用级激活。

## 决策

显式显示现有 macOS 主窗口时，在恢复或显示并聚焦窗口之后，请求应用获得焦点。最小化和普通窗口两个分支都使用 Electron 的应用激活 API。

## 考虑过的替代方案

- 在 E2E 测试中强制聚焦会掩盖用户可见的故障。
- 修改所有窗口类型还会影响不应激活应用的工具面板。

## 影响

现有单实例和协议路由保持不变。其他平台保留原有焦点行为，被动创建后台窗口也不受影响。

## 验证

- Regression — 两个重复启动测试分别模拟最小化和普通窗口下的后台 macOS 应用，修复前均失败，修复后全部 128 个 MainWindowService 测试通过。
- Regression — 原生 MP-133 场景用于端到端确认，目前待重跑。
