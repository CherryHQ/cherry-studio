# Agent Note: 默认值到达时保留绘图草稿身份

Status: implemented

[English](2026-11-08-painting-draft-default-identity.md) | 中文

## Problem

提供商和模型默认值可能在初始绘图草稿显示后才到达。重新创建未编辑的草稿会分配新 ID。由于 composer runtime 以该 ID 为 key，默认值同步会卸载已打开的模型选择器并丢弃搜索输入。打开选择器不算编辑草稿，因此无法阻止替换。

## Decision

将提供商和模型默认值应用到现有初始草稿，保留其 ID 和其他字段。保留初始草稿及未编辑保护：延迟默认值不能替换其他草稿，也不能覆盖用户选择的模型。

## Alternatives considered

- 重试 E2E 点击会掩盖用户可见的交互中断。
- 删除默认值同步会让草稿保留过时的提供商和模型选择。
- 删除 composer 的 key 会改变真实草稿切换时重置 runtime 的行为。

## Consequences

默认值同步更新模型选择，但不替换当前草稿会话。打开的选择器保留搜索内容并可继续使用。真实草稿切换仍会建立独立的 composer 会话。

## Verification

- 回归——真实 hook/composer/selector 测试在默认值到达前打开并搜索选择器。修复前默认值已生效，但原选择器脱离文档；修复后它保持可见、保留搜索，并可继续选择其他模型。
- 回归——56 项相关 renderer 测试、web 类型检查和定向 lint 通过。旧托管 MP-92 失败也丢失了模型弹层，但现有证据不能证明默认值竞态就是其实际触发原因；托管验收仍需复测。
