# Agent Note: 延后折叠工具结果的布局读取

Status: implemented

[English](2026-11-26-collapsed-conversation-tool-measurement.md) | 中文

## 问题

已完成的工具组进入 Work 消息列表时，Radix Collapsible 会测量初始隐藏的面板，Radix Presence 也会读取其动画样式。这些同步读取可能在新回复渲染期间强制重新计算样式和布局。

## 决策

修改 Collapsible，跳过初始隐藏且关闭的面板测量，等面板展开时再测量。修改 Presence，仅在状态为已挂载时由对应的 effect 读取动画样式。两处补丁均覆盖 CommonJS 和 ESM 构建。

## 考虑过的替代方案

在对话中替换折叠组件会重复实现展开和关闭行为，共享原语的其他使用方也仍会触发同类布局读取。

## 影响

面板展开、关闭和再次展开时继续使用 Radix 的测量和退出动画行为。升级 Radix 时需要重新检查这两处补丁。

## 验证

- Regression — `pnpm test:pkg:ui packages/ui/src/components/primitives/__tests__/accordion.test.tsx` 验证初始关闭的面板会延后尺寸和动画读取，并支持通过键盘展开、关闭和再次展开。
- Regression — 在本地 Electron 生产构建上重放 120 轮 AIMock Work 对话，27 次采样发送中观察到的隐藏工具面板读取从 34 次降到 0 次。
