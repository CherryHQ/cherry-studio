# Agent Note: 将反馈状态刷新限定在当前历史视图

Status: implemented

[English](2026-11-27-feedback-refresh-lifecycle.md) | 中文

## 问题

诊断历史的刷新可能在发起它的弹窗关闭后才结束。如果请求在弹窗重新打开后失败，就可能显示过期警告，并在新刷新仍在运行时启用分页。

## 决策

当前弹窗打开周期和可见报告 ID 对应的 effect 管理刷新警告和分页状态。清理时停用该 effect。旧刷新可以在主进程完成并更新报告缓存，只有当前 effect 可以结束弹窗的刷新状态。

## 考虑过的替代方案

- 跨打开周期复用同一个进行中的请求，会让重新打开的视图依赖上一次刷新，并推迟立即重新检查。

## 影响

重新打开历史会刷新可见报告的状态。当前请求失败时仍会显示已有警告，并保留最近已知的状态供查看。

## 验证

- Regression — `src/renderer/components/feedback/__tests__/DiagnosticHistoryDialog.test.tsx`：延迟关闭和重新打开前后的两个请求，验证旧请求失败既不会显示警告，也不会启用分页。
