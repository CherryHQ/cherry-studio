# Agent Note: Claude Code 存储打开诊断

Status: implemented

[English](2026-11-11-claude-code-storage-open-diagnosis.md) | 中文

## Problem

Claude Code 会话存储打开失败可能被显示为网络响应中断。运行时拒绝在错误到达流和渲染器之前丢弃了诊断信息。

## Decision

桌面驱动为存储打开失败设置应用翻译键，并记录原生拒绝代码和可用诊断。连接时仅在初次打开期间捕获诊断。轮换时由于并发运行时操作共用回调，不附加原因。创建失败保留原有身份。

渲染器对存储失败使用应用翻译；需要提供商组件的翻译仍使用分类和提供商链接。现在轮次以经过分类的存储打开错误结束，而不是显示网络提示。传输对照保持不变，仍显示流诊断。

## Alternatives considered

轮换时读取共享诊断槽可能将无关并发错误归因于打开操作。修改运行时契约以携带操作级诊断超出本次修复范围。

## Consequences

可见诊断指出存储打开步骤而不暴露原生路径。原生 SDK 可能屏蔽文件系统细节，因此日志中的诊断不一定能指出底层文件系统问题。

## Verification

- Regression — `desktopRuntime.integration.test.ts`：检查连接归因、创建操作区分和轮换时原因缺失。
- Regression — `AiStreamManager.test.ts`：检查存储错误形态和传输失败均保留部分输出且仅产生一个错误事件。
- Regression — `serializeError.test.ts`、`ErrorBlock.test.tsx`、`errorClassifier.test.ts` 和 `toast.test.ts`：检查存储和传输错误的序列化与展示。
