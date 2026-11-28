# Agent Note: Mermaid Worker 派发失败时结束渲染任务

Status: implemented

[English](2026-11-27-mermaid-worker-dispatch.md) | 中文

## 问题

Mermaid 会先将待渲染任务从队列中取出，再启动 Worker 或向它发送消息。如果推进队列时这两步之一同步抛错，调用方可能一直等待，后续任务也可能无法开始。

## 决策

派发失败时，让被取出的任务的所有调用方收到错误，丢弃该 Worker 后推进队列。只有消息发送成功后才开始计算渲染时限。

## 考虑过的替代方案

- 交由渲染超时处理无法覆盖 Worker 构造函数在定时器创建前就抛错的情况。

## 影响

受影响的预览会显示渲染错误，其他图表可在新的 Worker 上派发。如果 Worker 持续失败，每个受影响的请求都会以错误结束。

## 验证

- Regression — `src/renderer/services/__tests__/MermaidRenderService.test.ts`：验证 Worker 构造和发送消息失败时，受影响的请求收到错误，下一张图表仍可渲染。
