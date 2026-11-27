# Agent Note：Ollama 聊天历史中的工具参数以对象形式发送

Status: implemented

[English](2026-11-02-ollama-tool-call-arguments.md) | 中文

## 问题

Agent 历史会在 OpenAI 风格的消息表示中将工具调用参数保存为 JSON 文本。`modelMessageAdapter.ts` 会将该字符串保留为 AI SDK 工具调用输入，而 `ollama-ai-provider-v2` 序列化器又把它直接传入原生 `/api/chat` 的 `function.arguments`；但 Ollama 要求此处为对象。

## 决策

Ollama 提供商补丁会在构造原生聊天消息前解析字符串形式的工具调用输入，并原样传递已有的对象输入。转换仅发生在 Ollama 边界；共享历史仍保留 OpenAI 风格的表示。

## 备选方案

- 在共享历史适配器中解析参数：不采用，因为这会改变发送给所有提供商的表示。
- 原样发送 JSON 字符串：不采用，因为 Ollama 原生聊天接口要求对象。

## 后果

有效的 JSON 字符串工具输入会以对象形式发送给 Ollama，已有对象输入保持不变。无效 JSON 会在请求转换阶段报错，而不会作为字符串发送。

## 验证

- 回归 — `pnpm test:main src/main/ai/provider/custom/__tests__/boundary/ollama.chatReasoning.test.ts`：捕获多轮工具历史，并断言字符串与对象参数都会以原生对象形式发送。
