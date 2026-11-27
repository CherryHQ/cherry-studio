# Agent Note: 智能体会话缺少运行时能力配置

Status: implemented

[English](2026-10-19-agent-runtime-capability-lookup.md) | 中文

## 问题

本地 DataApi 返回的一个智能体使用 `local` 运行时类型，当前能力矩阵中没有对应条目。打开其会话时，页面读取缺失条目的 `slashCommands`，导致工作页在输入框渲染前崩溃。

## 决策

渲染层在提供上下文压缩操作前检查静态运行时命令是否存在。会话实时命令目录优先。如果两种来源都没有可用命令，则不提供压缩恢复操作，会话仍可阅读。

## 考虑过的替代方案

- 将未知类型映射到受支持的运行时：不采用，因为界面无法推断执行兼容性。
- 改写智能体或会话：防止展示层崩溃不需要改写这些数据。

## 后果

此改动仅影响能力展示，不映射运行时标识、不改变执行准入，也不改写已存储的智能体或会话数据。

## 验证

- Regression — `pnpm test:renderer src/renderer/pages/agents/__tests__/useAgentChatRuntimeState.test.tsx src/renderer/pages/agents/__tests__/AgentPage.test.tsx`：131 项测试通过，包括五种命令能力场景。未知类型场景在修复前复现了原异常。
- Regression — 真实 Electron：重试后，原会话正常打开，输入框可见，不再出现 `slashCommands` 渲染异常。标签页仍保持固定应用名称和图标。
