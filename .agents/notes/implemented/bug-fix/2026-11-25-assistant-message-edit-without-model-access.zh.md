# Agent Note: 在模型不可用时保存助手回复编辑

Status: implemented

[English](2026-11-25-assistant-message-edit-without-model-access.md) | 中文

## Problem

当前选择的 Cherry AI 模型要求登录时，编辑已有助手回复并点击发送，数据库仍保留原文。编辑器在判断本次编辑是否需要发起模型请求之前，就拦截了保存。

## Decision

即使模型不可用，也允许原地保存已编辑的助手回复。编辑用户消息并重新发送时，仍要求所选模型可用。

## Alternatives considered

要求用户先登录或切换模型才能保存回复，会让本地消息编辑依赖远端模型可用性。

## Consequences

退出登录或额度用尽时，用户仍可纠正已保存的助手回复。新生成和重新生成仍经过模型可用性检查。

## Verification

- Regression — `messageEditTyping.test.ts`：macOS Electron smoke 用例确认所选模型要求登录时，进入编辑后立即输入的字符仍完整，修改可保存。修复前数据库一直保留原文。
