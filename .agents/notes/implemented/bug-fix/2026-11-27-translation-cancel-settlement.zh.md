# Agent Note: 由渲染进程结束已取消的翻译

Status: implemented

[English](2026-11-27-translation-cancel-settlement.md) | 中文

## 问题

主进程可能用 `ai.stream.done` 通知提示词流已暂停。翻译桥接会把该事件当作成功完成。因此，就地翻译在收到文字前停止可能提示结果为空，收到部分文字后停止则可能触发成功回调。如果停止请求失败，渲染进程也可能一直等不到终止事件。

## 决策

调用方的取消信号让渲染进程以 `AbortError` 结束翻译、移除订阅，并继续向主进程转发已有的停止命令。普通聊天会在取消后等待已排队的写入。在同一控制器仍拥有该翻译时，保留最近一次成功持久化的非空译文，否则清除空白占位。消息查询可能还在显示旧快照，因此以持久化结果判断是否保留部分译文。

## 考虑过的替代方案

- 等待主进程送达终止事件会让渲染进程依赖可能永远收不到的响应，也会让暂停事件与取消操作竞争。

## 影响

主进程清理提供商请求时，渲染进程可立即结束取消流程。正常完成仍会向调用方交付去除首尾空白后的完整译文。

## 验证

- Regression — `src/renderer/utils/translate/__tests__/translateText.test.ts`：验证收到暂停事件或停止 IPC 失败时，取消会静默结束并清理订阅。
- Regression — `src/renderer/pages/home/messages/__tests__/homeMessageListAdapter.test.tsx`：验证消息查询刷新前，取消会清除空白输出并保留已保存的部分译文。
- Regression — macOS Electron 使用本地 SSE 提供商：验证两条停止路径、提供商连接关闭，以及后续成功翻译时保存完整译文。
