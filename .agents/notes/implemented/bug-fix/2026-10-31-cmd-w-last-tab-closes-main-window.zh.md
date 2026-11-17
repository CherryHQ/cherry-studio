# Agent Note：最后一个主窗口标签页的 Cmd+W 会关闭窗口

Status: implemented

[English](2026-10-31-cmd-w-last-tab-closes-main-window.md) | 中文

## 问题

在 macOS 上，对主窗口最后一个标签页按 `Cmd+W` 会关闭标签页并留下启动台回退页。这与关闭最后一个标签页时关闭窗口的 macOS 惯例相悖，也使用户无法通过键盘关闭窗口而不退出应用。本决策取代了[此前关于关闭最后一个标签页的决策](2026-10-20-last-tab-close-launchpad.md)。

## 决策

在 macOS 上，存在多个标签页时，`tab.close` 会关闭当前标签页；只剩一个标签页时，则请求执行 `window.close`。现有主窗口关闭路径会保留 macOS 行为：窗口关闭，应用仍可从 Dock 打开。

标签栏的 X 按钮仍会关闭标签页并显示启动台回退页。非 macOS 平台的快捷键行为不变。

## 考虑过的替代方案

- 让 `Cmd+W` 仍显示启动台回退页，虽与标签栏的 X 按钮一致，但不符合预期的 macOS 窗口关闭行为。
- 同时让标签栏的 X 按钮关闭窗口会扩大改动范围，并移除有用的启动台空态。

## 影响

只剩最后一个标签页时，`Cmd+W` 会关闭主窗口；存在多个标签页时则只关闭当前标签页。`Cmd+Shift+W`、标签栏的 X 按钮、分离子窗口行为以及关闭到托盘的行为均不变。

## 验证

- Regression — `src/renderer/components/layout/__tests__/AppShell.test.tsx`：macOS 上最后一个标签页的快捷键会请求 `window.close`；多个标签页和标签栏 X 按钮仍会关闭标签页；非 macOS 的回退行为不变。
