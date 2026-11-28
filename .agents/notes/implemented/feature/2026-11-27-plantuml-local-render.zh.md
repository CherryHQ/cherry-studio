# Agent Note: PlantUML 离线预览

Status: implemented

[English](2026-11-27-plantuml-local-render.md) | 中文

## 问题

原先的 Markdown PlantUML 预览在用户确认后会把图表源码发送到 `www.plantuml.com`。用户无法离线渲染私有图表，预览也受该服务器可用性影响。

## 决策

- PlantUML 代码块在流式输出结束后默认在本地渲染，沿用源码和预览切换。
- Web Worker 按需加载 PlantUML TeaVM 无界面引擎，并使用 Viz.js 支持依赖 Graphviz 的布局。预览发生变化时取消旧任务，渲染超过 10 秒后释放 worker。
- 预处理在离线环境中进行，图表可以内联定义宏。外部 URL、本地文件和未打包的标准库引用会显示渲染错误。净化后的 SVG 沿用缩放、复制和下载操作。
- 当 SVG 文本块没有提供背景时，固定版本的 TeaVM 引擎先读取图表解析后的背景设置，再使用默认值。

## 考虑过的替代方案

- 保留手动远程回退。该方案保留仅服务器支持的功能，但仍会传输图表源码。选定的方案终止这类传输。
- 调用本地 PlantUML Java 进程。各桌面平台都需要安装或打包 JVM，并管理子进程。
- 在渲染进程的主线程上使用官方浏览器版本。该版本的字符串渲染接口依赖 DOM API，同步布局可能延迟交互。无界面版本可在 worker 中运行。

## 影响

- 依赖远程资源、不受支持的标准库引用或完整 Java 渲染能力的图表可能报错，或呈现不同的效果。
- 生产构建包含约 13.1 MB 的独立 PlantUML worker 资源。Markdown 渲染器会在预览需要时加载它。

## 验证

- AC1 — macOS Electron 聊天在阻断外网请求时渲染了中文时序图和依赖 Graphviz 的类图，并验证了源码与预览切换。
- AC2 — macOS Electron 聊天显示语法错误和外部引用错误，期间没有外网请求。`PlantUmlPreview.test.tsx` 验证 SVG 中的图片和样式表元素会被移除。
- AC3 — `PlantUmlPreview.test.tsx` 验证源码更改、清空或关闭后会丢弃旧结果，以及超时后可以继续渲染。
- 回归 — Worker 测试覆盖默认背景、旧版皮肤参数和样式表背景。预览测试验证 SVG 净化并挂载后保留渲染器输出的背景。
