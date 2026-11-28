# Agent Note：修复大小写不敏感文件系统上的规划模式提示导入

Status: implemented

[English](2026-11-07-plan-hint-import-resolution.md) | 中文

## 问题

规划模式组件名为 `PlanModeHint.tsx`，其 Hook 却位于 `planModeHint.ts`。在大小写不敏感的文件系统上，解析组件导入时会先尝试 `.ts`，从而选中 Hook 模块。该模块没有导出 `PlanModeHint`，导致 macOS 渲染进程构建失败。

## 决策

将 Hook 模块命名为 `usePlanModeHint.ts`，并更新调用方。新名称符合 Hook 命名规范，与组件的文件名也不再仅有大小写差异。后续的历史记录工作（#23904，实现[历史操作提案](../../proposed/architecture/2026-11-08-agent-history-operation-boundaries.md) Step A）移除了整个草稿提示链路——`PlanModeHint.tsx`、`usePlanModeHint.ts`、专项测试及 `AgentComposer.tsx` 中的接线均已删除，改为显式的 Plan/Goal Quick Panel 入口——因此不再存在仅大小写不同的模块对。

## 考虑过的替代方案

为组件导入显式添加 `.tsx` 扩展名会保留有歧义的模块名称。使用不同的文件名可以同时修复所有调用方的解析问题。

## 影响

渲染进程中已没有可误解析的提示模块：规划模式的适用条件、草稿状态和展示方式均不改变，扩展名缺省的 `./agent/*` 导入也不会再因大小写折叠到另一个模块。`pnpm check:case-collisions`（已接入 `pnpm lint`）在 Linux CI 上守护这一模式，而最初的冲突在 Linux 上恰好不可见。

## 验证

- Regression — 原文件名使 macOS Electron 构建失败，重命名后构建通过。173 项定向输入框、令牌和规划意图测试全部通过。托管 macOS 和 Windows 的桌面验收继续在 PR 中跟踪。
- Regression — Windows 上 `tsrs --noEmit -p tsconfig.web.json --composite false` 与 `tsrs --noEmit -p tsconfig.e2e.json` 均通过；`tests/e2e/smoke/resourceCreateWizardActivity.test.ts` 已从 `../regression/helpers/models` 导入 `selectVisibleModel`。
- Regression — `pnpm check:case-collisions` 未发现仅大小写不同的 TypeScript 可解析模块名冲突，新增的 `scripts/__tests__/check-case-sensitive-collisions.test.ts` 覆盖了最初的 `PlanModeHint.tsx`/`planModeHint.ts` 组合。
