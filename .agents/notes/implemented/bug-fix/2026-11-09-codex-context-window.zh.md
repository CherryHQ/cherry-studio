# Agent Note: 重建供应商配置时保留 Codex 上下文设置

Status: implemented

[English](2026-11-09-codex-context-window.md) | 中文

## 问题

Codex 供应商配置重建会删除 `model_context_window` 和 `model_auto_compact_token_limit`，既不恢复它们，也不使用所选模型的容量。仅更新配置时也会丢失这两个设置（Issue #24006）。

## 决策

重建供应商配置时，若所选模型的 `contextWindow` 是正安全整数，则使用该值；否则保留有效的现有窗口值。有效的现有压缩限制独立保留。无效值被省略。仅更新配置时使用现有值。清除和自有登录会移除这两个键；直接供应商传入的草稿原样提交，网关草稿则会重建。

## 考虑过的替代方案

- 元数据不可用时总是移除现有限制：会丢失手动设置。
- 将这两个键移出管理范围：会导致清除和自有登录无法移除生成的上下文设置。
- 根据窗口推导压缩限制：会引入缺乏依据的策略。

## 后果

切换到容量未知的模型时，有效的现有窗口值会保留，即使它是为之前的模型生成的。文件无法区分生成值和手写值；不跟踪来源。两个限制之间不施加关联约束。

## 验证

- Regression — `src/renderer/pages/code/cliConfig/__tests__/builders.test.ts`：检查优先级、独立保留、无效值和安全整数的无损序列化。
- Regression — `src/renderer/pages/code/cliConfig/__tests__/writeCliConfigDraft.test.ts`：检查直接和网关写入、元数据不可用及传入文件的行为。
- Regression — `src/renderer/pages/code/cliConfig/__tests__/draftUpdater.test.ts`：检查仅更新配置时保留两个限制和连接信息。
- Regression — `src/renderer/pages/code/cliConfig/__tests__/clear.test.ts`：检查清除操作移除两个限制并保留无关设置。
- Regression — `src/renderer/pages/code/cliConfig/__tests__/ownLogin.test.ts`：检查自有登录移除两个限制并保留无关设置。
