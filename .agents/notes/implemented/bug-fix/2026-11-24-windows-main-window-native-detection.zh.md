# Agent Note: 让 Windows 主窗口可被原生窗口检测识别

Status: implemented

[English](2026-11-24-windows-main-window-native-detection.md) | 中文

## 问题

Cherry Studio 设置 Windows 主窗口的透明度时，即使透明度为 1，Electron 也会将其标记为分层窗口。Lively Wallpaper 会在检查最大化状态前过滤分层窗口。因此系统最大化成功，Lively 的窗口过滤仍会排除该窗口。 [Issue #25107](https://github.com/CherryHQ/cherry-studio/issues/25107)

## 决策

Windows 主窗口在托盘生命周期中使用默认透明度。隐藏时仍移除任务栏入口，先最小化以移交焦点，再隐藏窗口。重新显示或还原时恢复任务栏入口。

## 备选方案

- 只对恢复透明度的调用加条件，无法解除已经隐藏到托盘的窗口的分层状态。
- 直接隐藏并省去最小化步骤，会丢失 [PR #16277](https://github.com/CherryHQ/cherry-studio/pull/16277) 为 Windows 引入的焦点移交行为。

## 影响

Windows 用系统自身的最小化过渡，无需覆盖窗口透明度。原生检测工具能够识别可见窗口，隐藏到托盘的窗口仍不可见。

## 验证

- Regression — `src/main/services/__tests__/MainWindowService.test.ts` 验证任务栏入口、最小化与隐藏的顺序，并检测主窗口的透明度变更。
- Regression — 在隔离的 Windows Electron 环境检查原生最大化、全屏与托盘隐藏和还原。最大化的 HWND 具备 `WS_MAXIMIZE` 和 `IsZoomed`，且无 `WS_EX_LAYERED`。
