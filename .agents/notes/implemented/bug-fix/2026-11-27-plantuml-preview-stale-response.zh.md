# Agent Note: PlantUML 响应只更新当前预览

Status: implemented

[English](2026-11-27-plantuml-preview-stale-response.md) | 中文

## 问题

PlantUML 异步获取 SVG。旧响应可能在输入已替换或清空后才完成，并把过期内容挂载到预览中。

## 决策

预览在发起请求前记录输入标识，挂载 SVG 前立即检查该标识。输入改变或卸载时使标识失效。

## 考虑过的替代方案

- 按顺序等待每个请求，会让较慢的旧渲染阻塞当前预览。

## 影响

当前有效图表仍通过已有的 SVG 路径渲染。网络请求契约保持原样。

## 验证

- Regression — `src/renderer/components/Preview/__tests__/PlantUmlPreview.test.tsx`：验证延迟响应无法覆盖最新图表或填充已清空的预览。
