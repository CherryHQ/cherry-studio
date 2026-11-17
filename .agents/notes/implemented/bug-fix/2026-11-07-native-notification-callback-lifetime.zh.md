# Agent Note: 在原生通知交付结束前保留点击回调

Status: implemented

[English](2026-11-07-native-notification-callback-lifetime.md) | 中文

## Problem

`NotificationService` 将 Electron 通知保存在局部变量中。系统仍在显示通知时，垃圾回收可能已经回收其 JavaScript 包装对象。此时真实的 macOS 点击会激活应用，却不再调用会话导航回调，使用户停留在设置页面。

## Decision

服务保留每个原生通知，直到收到点击、关闭或失败事件。持久化通知和直接系统通知共用这一生命周期所有者。同步显示失败时释放引用，服务停止时清空剩余引用。

## Alternatives considered

仅在测试观察器中保留通知会掩盖产品缺陷。根据应用激活事件导航会丢失通知目标，并干扰正常激活。将所有通知保留到进程结束则会累积已经结束的包装对象。

## Consequences

垃圾回收不再移除仍然有效的点击回调。交付终止事件会释放包装对象。停止服务会丢弃服务引用，不删除用户持久化的通知记录，也不清空系统通知历史。存储格式和 IPC 契约均不改变。

## Verification

- Regression — `NotificationService.test.ts`：五个新增垃圾回收用例在修复前失败、修复后通过，验证回收后的未读记录消费及会话导航，以及点击、关闭、失败和服务停止后的引用释放。
- Regression — `pnpm exec vitest run --project main src/main/services/__tests__/NotificationService.test.ts`：123 项通过，保留一个原有的平台限定跳过项。
- Electron — 已签名的隔离 macOS 探针确认：包装对象被回收后，真实原生点击不会产生 JavaScript 点击事件；保留包装对象后，相同的强制回收仍保留该事件。完整业务通知的 E2E 验证单独记录在 PR 中。
