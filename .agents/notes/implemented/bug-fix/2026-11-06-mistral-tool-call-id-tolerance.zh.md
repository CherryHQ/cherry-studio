# Agent Note: 容忍 Mistral 流式工具调用缺失 ID

Status: implemented

[English](2026-11-06-mistral-tool-call-id-tolerance.md) | 中文

## 问题

`@ai-sdk/mistral@3.0.30` 的 `mistralChatChunkSchema` 要求 `tool_calls[].id` 与 `function` 必填。提供商的首个 tool-call delta 缺少 `id` 时，整个 chunk 会在 `choices.0.delta.tool_calls.0.id` 处触发 `TypeValidationError`。Issue #23741 的报告报文中，`function.name` 也是空串。适配器将 error part 塞入流后继续运行，ToolCall 随之丢失，用户看到「未知错误」。

## 决策

`patches/@ai-sdk__mistral@3.0.30.patch` 中的 vendored patch 将流式 `index`、`id`、`function.name` 和 `function.arguments` 放宽为 nullish。`function` 对象本身改为 `.optional()`，显式 `null` 仍被拒绝。

适配器不再逐 delta 直接发出 start/delta/end/call，而是按 index → id → latest call 累积分片。首次遇到 name 为字符串的分片时，使用提供商的 `id` 或 `generateId()` 一次性确定公开 ID。后到的真实 ID 只登记为别名，不替换已公开 ID。

在 `flush` 阶段，适配器先检查所有未解析的骨架；若存在，则抛出 `InvalidResponseDataError: Expected 'function.name' to be a string.`，不会先发出任何最终 `tool-call`。补丁注册注释规定：只有上游版本自身能容忍缺 ID 的首次分片，且仓库全部回归用例在不打补丁时通过，才能删除补丁。

## 考虑过的替代方案

- 将 `@ai-sdk/mistral` 升级至 3.0.79：首次见到的分片若 `id == null`，仍会抛出 `InvalidResponseDataError: Expected 'id' to be a string.`，且升级会带入无关的请求序列化变化。仅升级到该版本不能作为删除补丁的判据。
- 在应用层吞掉 error part 或补默认 ID：这也会将畸形块一起放过，且无法恢复已丢失的 tool call。
- 只在应用层重试：流是单趟的，重试无法找回该流中已经丢弃的分片。

## 影响

最终 `tool-input-end` 和 `tool-call` 在流尾发出，因此工具执行时机以及它们与 text/reasoning/raw part 的相对顺序随之变化。空 arguments 不再产生空的 `tool-input-delta`。

如果提供商始终不给非空 name，工具名仍为空串，执行会因找不到该工具而失败。本次修复只保证不再因缺 `id` 丢掉整轮。合成 ID 是客户端关联标识，提供商是否接受下一轮携带该 ID，仍需通过真实提供商链路验证。

## 验证

以下校验已在上一轮实现中通过；本次仅补充文档，记录这些结果，不重新执行。

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/provider/__tests__/mistralToolCallIdOptionalPatch.test.ts src/main/ai/provider/__tests__/openaiCompatibleToolCallSkeletonPatch.test.ts`：退出 0，两个文件全部通过，合计 40 个测试。新增的 11 条覆盖报告报文、骨架、缺 ID、原生单 chunk deep equality、未解析骨架、骨架校验前不得泄出已完成调用、交错 index、非法 `function`、`streamText` + `execute` 配对及纯文本。
- Regression — `node node_modules/oxlint/bin/oxlint --deny-warnings src/main/ai/provider/__tests__/mistralToolCallIdOptionalPatch.test.ts`：退出 0。
- Regression — `node node_modules/oxfmt/bin/oxfmt --check src/main/ai/provider/__tests__/mistralToolCallIdOptionalPatch.test.ts`：退出 0。
- Regression — `NODE_OPTIONS=--max-old-space-size=16384 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`：退出 0。
- Regression — `pnpm install --frozen-lockfile --ignore-scripts`：退出 0，lockfile 未变化。
