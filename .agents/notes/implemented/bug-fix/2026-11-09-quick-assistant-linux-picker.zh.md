# Agent Note: Linux 快捷助手选择器窗口几何

Status: implemented

[English](2026-11-09-quick-assistant-linux-picker.md) | 中文

## Problem

打开选择器会将 Linux 快捷助手从输入框高度扩展为弹层高度。原生窗口移动和渲染进程布局可能发生在不同帧，使输入框短暂偏离原有屏幕位置。

## Decision

Linux 为弹层保留至少 560 像素的窗口高度。在输入条视图中，Electron `setShape` 将绘制和输入区域限制为底部输入框矩形；弹层和会话面板恢复完整矩形。窗口缩放事件会更新形状。macOS 和 Windows 保留现有的悬停转发行为。

## Alternatives considered

禁用缩放动画仍然需要改变原生窗口几何。仅保留透明留白会拦截后方窗口的点击；Linux 无法使用现有的悬停转发机制。

## Consequences

常规弹层高度下，选择器切换不再改变窗口尺寸或位置。Linux 依赖 Electron 的实验性形状 API；不同合成器的绘制和点击穿透仍需交互验收。超出预留区域的高度仍可能需要缩放窗口。

## Verification

- Regression — `pnpm exec vitest run --project main src/main/services/__tests__/QuickAssistantService.test.ts`：18 项测试通过，覆盖选择器切换时窗口保持原位，以及收起后输入区域恢复。
- Regression — Electron 45.2.2 最小探针在 X11 和 Wayland 下完成形状切换，无调用错误；X11 窗口边界保持不变。这些探针不能证明完整应用中的视觉效果和点击穿透已通过验收。
