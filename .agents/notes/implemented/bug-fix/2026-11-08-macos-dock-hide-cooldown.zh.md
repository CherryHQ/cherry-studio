# Agent Note: 遵守 macOS Dock 隐藏冷却期

Status: implemented

[English](2026-11-08-macos-dock-hide-cooldown.md) | 中文

## 问题

快速显示并关闭窗口后，即使所有参与计算的窗口均已隐藏，Dock 图标仍可能可见。Electron 45.2.2 在 `DockShow()` 后的一秒内会忽略 `DockHide()`。WindowManager 已记录隐藏意图，后续相同状态更新也就不会重试被忽略的原生请求。

## 决策

WindowManager 在最近一次 Dock 显示请求满 1100 毫秒后才隐藏。普通隐藏与异步显示完成均经过同一个最新意图检查。新的显示请求取消待执行的隐藏。停止与销毁时取消延后操作，并阻止迟到的显示回调再次安排隐藏。

## 考虑过的替代方案

- 放慢 E2E 交互会掩盖用户可见的问题。
- 每次可见性更新都重试，会产生多余原生操作，也没有遵守 Electron 冷却期。
- 独立轮询服务会重复窗口管理器对 Dock 意图的所有权。

## 影响

快速关闭后，图标可能保留至剩余冷却期结束。窗口贡献与 Dock hold 规则仍决定期望状态。延后操作由现有服务生命周期管理，不会在更新的显示请求或关闭后隐藏 Dock。

## 验证

- Regression — `WindowManager.quirks.test.ts`、`WindowManager.test.ts` 与 `MainWindowService.test.ts` 的 301 项测试通过。Dock 测试模拟原生冷却期，验证快速关闭、重新打开、延迟显示完成、关闭服务与重启服务后的实际可见性，同时检查池化窗口和 Dock hold。
- Regression — 修复前，所拥有的本机 MP-111 观察程序记录到托管窗口和 Dock 意图均隐藏，但原生 Dock 仍显示。修复后，本机 MP-111 在十秒内通过，所在的五用例原生运行成功清理了所拥有运行资源。完整桌面验收仍需单独完成。
