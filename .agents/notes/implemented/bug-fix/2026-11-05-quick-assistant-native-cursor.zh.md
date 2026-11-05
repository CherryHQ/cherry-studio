# Agent Note: 快捷助手原生拖拽光标

Status: implemented

[English](2026-11-05-quick-assistant-native-cursor.md) | 中文

## Problem

CSS `cursor: grab` 无法可靠改变 Electron 原生拖拽区域上的 macOS 光标。仅检查计算后的 CSS 无法验证这个行为。

## Decision

QuickAssistantService 创建 macOS 面板时，为该窗口启用现有 Node-API addon 的光标支持。addon 先把面板事件交给 Electron，再检查 Chromium 内容视图的原生命中结果：视图内返回 nil 表示原生拖拽背景，此时悬停显示 AppKit 张开手型。No-drag 控件继续由 Chromium 处理事件。隐藏和鼠标穿透窗口不接管光标。

## Alternatives considered

定制 Electron 发行版会增加升级和打包工作。渲染进程驱动窗口移动会重复实现原生拖拽和多屏行为。同步拖拽矩形会增加另一套区域管理。addon 因此复用现有原生命中检测，保持系统移动窗口的行为。

## Consequences

仅显式标记的面板启用此功能。关联对象保存每个窗口的标记，不持有窗口引用；Node 环境清理时恢复原方法。实现依赖 Electron 面板类和 Chromium 命中检测约定，升级 Electron 时必须重新验证。在拖拽区域普通左键按下时显示握拳。公共运行循环模式中的计时器仅在按住期间维持握拳，松开、隐藏、关闭或鼠标穿透时停止，并以弱引用持有窗口。鼠标松开事件交给 Electron 后恢复悬停提示；当窗口服务器吞掉松开事件时，计时器也能检测释放。

## Verification

- Regression — `node native/selection-panel/build.js arm64` 和 `node native/selection-panel/build.js x64`：两个 macOS addon 目标均编译通过；尚未验证 x64 运行。
- Regression — `pnpm test:main src/main/services/__tests__/QuickAssistantService.test.ts`：现有快捷助手生命周期和窗口几何行为测试通过。
- Regression — 运行中的 macOS Electron 原生光标检查：工具栏空白处为 `NSCursor.openHandCursor`，编辑区为文字光标，离开窗口清除手型。计算后的 CSS 不作为验收信号。

- Regression — 在运行中的 macOS 实例注入原生按下、拖动和松开事件：窗口位置改变时光标保持 `closedHandCursor`，松开恢复 `openHandCursor`，按住期间隐藏窗口清除手型。证据：`.context/cherry-electron-dev/native-grabbing-evidence.json`。
