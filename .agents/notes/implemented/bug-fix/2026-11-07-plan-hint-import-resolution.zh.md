# Agent Note：修复大小写不敏感文件系统上的规划模式提示导入

Status: implemented

[English](2026-11-07-plan-hint-import-resolution.md) | 中文

## 问题

规划模式组件名为 `PlanModeHint.tsx`，其 Hook 却位于 `planModeHint.ts`。在大小写不敏感的文件系统上，解析组件导入时会先尝试 `.ts`，从而选中 Hook 模块。该模块没有导出 `PlanModeHint`，导致 macOS 渲染进程构建失败。

## 决策

将 Hook 模块命名为 `usePlanModeHint.ts`，并更新调用方。新名称符合 Hook 命名规范，与组件的文件名也不再仅有大小写差异。

## 考虑过的替代方案

为组件导入显式添加 `.tsx` 扩展名会保留有歧义的模块名称。使用不同的文件名可以同时修复所有调用方的解析问题。

## 影响

渲染进程可以正确解析两个模块，规划模式的适用条件、草稿状态和展示方式均不改变。

## 验证

- Regression — 原文件名使 macOS Electron 构建失败，重命名后构建通过。173 项定向输入框、令牌和规划意图测试全部通过。托管 macOS 和 Windows 的桌面验收继续在 PR 中跟踪。
