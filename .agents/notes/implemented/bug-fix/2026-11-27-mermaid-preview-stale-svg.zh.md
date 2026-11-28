# Agent Note: 阻止过期 Mermaid 预览写入

Status: implemented

[English](2026-11-27-mermaid-preview-stale-svg.md) | 中文

## 问题

Mermaid Worker 可能在预览内容或渲染选项改变后才返回。在替代预览渲染前，旧结果可能挂载到当前预览。

## 决策

输入改变或宿主卸载时，Mermaid 预览停用旧渲染请求。只有当前请求可以更新预览的 SVG。

## 考虑过的替代方案

- Worker 队列可以合并尚在等待的请求，已派发的渲染则无法撤回。

## 影响

替代渲染就绪后可以显示。过期结果无法更新已复用或已分离的宿主。

## 验证

- Regression — `src/renderer/components/Preview/__tests__/MermaidPreview.test.tsx`：控制源内容改变和卸载前后的 Worker 响应。
