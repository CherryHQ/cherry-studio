# Agent Note: 打包独立的沙箱 preload

Status: implemented

[English](2026-11-07-preload-sandbox-bundles.md) | 中文

## 问题

MP-123 可以加载网页，但无法启用标注。生成的 webview preload 在运行时加载 zod，而外部网页正确启用了沙箱。Electron 沙箱无法加载该模块，因此标注桥接从未启动。

## 决策

使用 electron-vite 内置的 isolatedEntries，并禁用 preload 依赖外置。每个入口独立打包 JavaScript 依赖，不引用共享分块。保留独立的 webview 桥接、上下文隔离和外部网页沙箱；可信应用窗口的策略不变。

## 考虑过的替代方案

- 禁用网页沙箱会削弱不可信页面的隔离边界。
- 将单个模块复制到 preload 文件旁边，也无法让沙箱 require 加载它们。

## 影响

不同 preload 入口可能重复打包依赖。构建产物测试实际执行 webview 包，只允许导入 Electron，并验证会话状态响应。

## 验证

- 回归 — 修复前，构建产物测试报 Sandbox cannot load zod。
- 回归 — 沙箱契约和现有 Sentry 构建检查通过，共 8 项。
- Electron MP-123 仍待验证。
