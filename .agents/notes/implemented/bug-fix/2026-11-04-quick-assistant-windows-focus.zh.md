# Agent Note: Windows 下隐藏速记助手时用 blur 加 hide 交还焦点

Status: implemented

[English](2026-11-04-quick-assistant-windows-focus.md) | 中文

## 问题

在 Windows 上，用全局快捷键隐藏速记助手（Quick Assistant）面板后，键盘焦点仍留在 Cherry Studio，没有回到之前的前台应用。用户必须点击原应用或按 Alt+Tab 才能继续输入（issue #23292）。

`hideQuickAssistant()` 在 Windows 上使用 `setOpacity(0)` 加 `minimize()`。该做法复制自 `MainWindowService.minimizeToTrayOnWindows()`（PR #16277），对普通重叠窗口有效。但速记助手窗口是 `alwaysOnTop` 加 `skipTaskbar: true` 加 `minimizable: false`（`windowRegistry.ts`，`WindowType.QuickAssistant`），对这类工具窗口 `minimize()` 不能可靠地交还激活状态。最小化后的窗口 `isVisible()` 仍为 true，导致 `toggleQuickAssistant()` 一直重复调用隐藏而无法重新显示。

## 决策

Windows 隐藏流程改为 `setOpacity(0)`，已聚焦时先 `blur()`，再 `hide()`。`blur()` 释放激活状态，使之前的前台应用恢复焦点；`hide()` 移除工具窗口；透明度保证切换过程无闪烁，下次显示时 `proceedShow()` 恢复透明度为 1。

`QuickAssistantService.ts` 的配套改动：

- `toggleQuickAssistant()` 以 `isVisible() && !isMinimized()` 判断可见，与 `MainWindowService.toggleMainWindow()` 一致，使旧版本遗留的最小化窗口重新显示而不是再次隐藏。
- `hideQuickAssistant()` 在窗口已隐藏时直接返回；经 `onBlur` 的 `blur()` 重入由 `isFocused()` 防护限制。
- `closeQuickAssistant()` 仅在 Windows 上委托给 `hideQuickAssistant()`。macOS 和 Linux 保持普通 `hide()`，使设置页发起的显式关闭不会因过期的显示时 `wasMainWindowFocused` 值而触发 macOS `<26` 的 `app.hide()` 路径。
- `onMainVisible` 保持直接 `hide()`，因为主窗口本身正在获取激活状态。
- `proceedShow()` 保留对旧版本最小化窗口的 `show()`（而非 `restore()`）恢复逻辑。

macOS 隐藏（26 以下版本的 `app.hide()`）、Linux 隐藏、置顶时的 blur 行为以及无闪烁显示流程均保持不变。

## 考虑过的替代方案

- Windows 继续沿用 `minimize()`：否决，工具窗口无法交还激活状态，且 `isVisible()` 为 true 会破坏下一次切换。
- `proceedShow()` 恢复时用 `restore()` 代替 `show()`：否决，现有注释记录了 Electron 多显示器缩放因子缺陷。
- `closeQuickAssistant()` 全平台委托给 `hideQuickAssistant()`：否决，macOS `<26` 下设置页发起的关闭可能因过期的 `wasMainWindowFocused == false` 调用 `app.hide()`，把用户正在操作的设置窗口藏起来。
- 新增原生 `SetForegroundWindow` 模块：否决，与 PR #16277 的结论一致，属于过度设计。

## 影响

在 Windows 上用快捷键、blur 自动隐藏或显式关闭隐藏速记助手后，输入直接回到之前的前台应用，无需额外点击或 Alt+Tab，下一次快捷键显示面板时无可见闪烁。反复切换不会进入“只隐藏不显示”的卡死状态。主窗口托盘行为、macOS 与 Linux 隐藏路径、置顶行为和全屏处理均保持不变。

## 验证

- Regression — `pnpm vitest run --project main src/main/services/__tests__/QuickAssistantService.test.ts src/main/services/__tests__/MainWindowService.test.ts src/main/ipc/handlers/__tests__/quickAssistant.test.ts --silent`：3 个文件 / 119 项测试通过，覆盖 Windows blur 加 hide、已失焦时跳过 blur、最小化视为隐藏的切换、旧最小化窗口不用 restore 的显示恢复、已隐藏时无操作，以及 macOS 关闭不调用 app.hide。
- Regression — `pnpm exec oxlint src/main/services/QuickAssistantService.ts src/main/services/__tests__/QuickAssistantService.test.ts src/main/core/window/windowRegistry.ts --deny-warnings`：干净。
- Regression — `pnpm exec tsc --noEmit -p tsconfig.node.json --composite false`：干净。
