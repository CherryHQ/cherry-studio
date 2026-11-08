# Agent Note: 生成图像的消息归属与清理

Status: implemented

[English](2026-11-08-generated-image-file-refs.md) | 中文

## 问题

`generate_image` 会将生成的图像持久化为 FileEntry 行，但只在工具输出中保留其 ID。没有消息引用时，删除所属的聊天消息或智能体会话消息无法级联清理这些文件，而 `manual` 清理策略又会阻止自动回收。

## 决策

聊天消息和智能体会话消息服务都在现有消息文件引用表中，以 `generated` 角色注册生成工具输出。普通聊天使用 `generateImageOutputSchema` 验证 `tool-generate_image` 输出；Claude Code MCP 桥接会返回结构化图像 ID，并在消息投影过程中保留这些 ID。两个表的约束均允许此角色。

`generateImageFromPrompt` 使用 `delete_when_unreferenced` 创建输出。消息引用会在消息存在期间保护每个输出；删除消息会级联删除引用，之后常规清理任务即可回收文件。

## 考虑过的替代方案

- 保留 `manual`：可以在无引用时保留文件，但会使其永久留存，并让已删除消息的输出成为孤立文件。
- 发出重复的文件部分：现有工具结果渲染已展示图像，再发出文件部分会导致图像重复显示。

## 后果

生成文件在普通聊天和智能体会话中都遵循相同的消息归属边界。自动清理仍需等待常规宽限期，并确认不存在任何持久引用。

## 验证

- 回归 — `src/main/data/services/__tests__/MessageService.test.ts`：生成工具输出会为每个已持久化图像创建一个 `generated` 引用。
- 回归 — `src/main/data/services/__tests__/AgentSessionMessageService.test.ts`：结构化 MCP 输出会创建生成引用，删除消息会级联清理引用。
- 回归 — `src/main/data/services/__tests__/FileEntryService.test.ts`：只要消息引用仍存在，生成图像就会被 GC 排除；删除消息后，该图像即可回收。
- 回归 — `src/main/ai/runtime/claudeCode/__tests__/ClaudeMessageMetadata.test.ts`：结构化 MCP 输出在元数据装饰后仍会保留。
- 回归 — `src/main/ai/mcp/servers/__tests__/cherryBuiltinTools.test.ts` 与 `src/main/ai/tools/adapters/aiSdk/builtin/__tests__/PaintingTool.test.ts`：MCP 输出会提供图像 ID，生成条目使用自动清理策略。
- 回归 — `pnpm db:migrations:check`：生成角色约束已由追加迁移表示。
