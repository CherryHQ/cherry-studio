# Agent Note: Chat 切换 Gemini 模型时的工具签名

Status: implemented

[English](2026-11-25-gemini-chat-tool-signature-replay.md) | 中文

## Problem

在 CherryIN 上，Gemini 3.8 Flash 完成工具调用后，同一个 Chat 切换到 Gemini 4 Argon 时会把 Flash 的签名发给 Argon，收到 HTTP 400。回复已保存所选模型 ID，但此前交给 AI SDK 的历史丢失了这个字段。

即使模型名相同，切换供应商连接也可能使旧回复正文上的签名失效。

## Decision

将已完成回复的模型 ID 传入请求历史。Gemini middleware 将它与目标模型比较，发现模型不同时，为当前用户文本之前带签名的客户端工具调用标记显式省略。Google 序列化器省略标记的签名，保留工具调用和结果。

对于带签名的正文，middleware 用签名匹配历史来源，只从发出的正文 part 省略签名。来源比较包含供应商连接。

## Alternatives considered

在 Argon 对照中，把旧签名换成 `skip_thought_signature_validator` 仍然返回 400。同一请求省略该字段后返回 200。删除整组工具调用和结果会丢掉目标模型能够接收的上下文。

## Consequences

Chat 保留已存签名，供切回原模型时回放。来源无法识别或工具调用 ID 有歧义时，沿用已有回放行为。这项兼容规则适用于原生 Google Generate Content 协议。

## Verification

- Regression — `geminiHistorySignatureReplay.test.ts`：跨模型历史保留正文及配对的工具历史，省略旧签名。测试也覆盖同名模型跨供应商连接的纯正文历史，并验证同模型、当前轮和来源未知的回放保留签名。
- Regression — `PersistentChatContextProvider.test.ts`：后续请求包含已完成回复所保存的模型 ID。
- Electron — 在 CherryIN 上，Flash 切到 Argon 的请求保留配对的工具历史并省略旧签名。首次返回 503，重试返回 200。Flash 同模型续聊携带原签名并返回 200。
- Electron — 在 OpenRouter 上，Gemini 3.1 Flash Lite 完成工具续聊，Gemini 4 Neon 随后读取这段历史并完成自己的工具调用。成功请求携带原有 `reasoning_details`，未添加 Google 兼容格式的 `extra_content`。
- Electron — 同为 Gemini 3.1 Flash Lite，从 AiHubMix 切换到官方 Gemini 后，之前失败的提示返回 200。请求保留历史正文和配对的工具记录，省略正文签名。原消息仍保存原签名。
