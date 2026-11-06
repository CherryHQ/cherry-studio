# Agent Note: 快捷助手原生拖拽光标

Status: implemented

[English](2026-11-05-quick-assistant-native-cursor.md) | 中文

## Problem

CSS `cursor: grab` 无法可靠改变 Electron 原生拖拽区域上的 macOS 或 Windows 光标。仅检查计算后的 CSS 无法验证这个行为。

## Decision

QuickAssistantService 创建 macOS 面板时，为该窗口启用现有 Node-API addon 的光标支持。addon 先把面板事件交给 Electron，再检查 Chromium 内容视图的原生命中结果：视图内返回 nil 表示原生拖拽背景，此时悬停显示 AppKit 张开手型。No-drag 控件继续由 Chromium 处理事件。隐藏和鼠标穿透窗口不接管光标。

Windows 的启用 API 接收 enabled 标记，为该窗口及其同线程子 HWND 安装子类回调。QuickAssistantService 将现有视图状态投射为该标记：bar 和 quick-panel 启用手型提示，会话面板及其标题栏保留默认光标。启用视图内的区域判断由根窗口的 `WM_NCHITTEST` 结果 `HTCAPTION` 决定；addon 应用 Chromium 的张开/握拳光标资源，不改变原生移动行为。客户区控件和缩放边缘保留 Electron 的行为。必须等子窗口处理完鼠标移动后再应用悬停提示，且子窗口的捕获切换不能结束原生标题栏拖动。禁用时立即清除手型和计时器，不引入渲染进程区域镜像或第二个视图所有者。macOS 的单参数启用方式保持原样。

## Alternatives considered

定制 Electron 发行版会增加升级和打包工作。渲染进程驱动窗口移动会重复实现原生拖拽和多屏行为。同步拖拽矩形会增加另一套区域管理。addon 因此复用现有原生命中检测，保持系统移动窗口的行为。

## Consequences

仅显式标记的面板启用此功能。关联对象保存每个窗口的标记，不持有窗口引用；Node 环境清理时恢复原方法。实现依赖 Electron 面板类和 Chromium 命中检测约定，升级 Electron 时必须重新验证。在拖拽区域普通左键按下时显示握拳。公共运行循环模式中的计时器仅在按住期间维持握拳，松开、隐藏、关闭或鼠标穿透时停止，并以弱引用持有窗口。鼠标松开事件交给 Electron 后恢复悬停提示；当窗口服务器吞掉松开事件时，计时器也能检测释放。

Windows 使用每 HWND 子类回调，计时器仅在拖动期间运行，不使用全局 hook 或空闲光标轮询。隐藏、最小化、取消及鼠标穿透均停止拖动。HWND 销毁和 Node 环境清理会移除子类回调并释放光标资源。Windows 没有系统 grab/grabbing 光标对，因此 addon 内嵌采用 BSD 许可证的 Chromium 光标。现有构建和打包入口也负责构建 Windows 目标。

Windows 非整数 DPI 下的窗口几何仍是已知上游限制，与光标处理分开。在 175% DPI 下，renderer 子窗口可能比父 HWND 客户区大 1–2 个物理像素，裁掉正常边框；反复读取并写回 bounds 也可能使窗口增长。两种行为都能在不加载此 addon 的独立 Electron 45.2.2 中复现，使用内容区 bounds API 也未消除。本次保留现有产品尺寸逻辑和会话面板的正常语义描边，不添加负偏移或 DPI 补偿。证据：`.context/cherry-electron-dev/content-bounds-ab/report.md`。

## Verification

- Regression — 先前的 macOS 验证，本次 Windows 扩展未重跑：`node native/selection-panel/build.js arm64` 和 `node native/selection-panel/build.js x64` 编译两个 macOS addon 目标；尚未验证 x64 运行。
- Regression — 先前的 `pnpm test:main src/main/services/__tests__/QuickAssistantService.test.ts`：现有快捷助手生命周期和窗口几何行为测试通过。
- Regression — 先前的 macOS 验证，本次 Windows 扩展未重跑：运行中的 Electron 原生检查确认工具栏空白处为 `NSCursor.openHandCursor`，编辑区为文字光标，离开后清除手型。计算后的 CSS 不作为验收信号。

- Regression — 先前的 macOS 验证，本次 Windows 扩展未重跑：原生按下、拖动和松开使窗口移动并保持 `closedHandCursor`，松开恢复 `openHandCursor`，按住期间隐藏会清除手型。证据：`.context/cherry-electron-dev/native-grabbing-evidence.json`。
- Regression — Windows 11 x64 / Electron 45.2.2、175% DPI：bar/quick-panel/标题栏的十五个原生光标采样全部匹配，bar 视图为 grab/grabbing、会话标题栏为系统箭头；原生移动、鼠标静止时视图切换、文字/按钮及缩放边缘均通过。证据：`.context/cherry-electron-dev/pr-19106-final/native-cursor-comparison.json`。
- Regression — 九个主进程、渲染层和打包专项测试文件（288 项）通过，覆盖不调整尺寸时的视图策略变化及模拟平台下保持原样的 macOS 创建时启用方式。macOS 原生源码未改；本次 macOS 编译与运行验收仍未验证。
