# Agent Note：不重放 Anthropic 加密网页搜索结果

Status: implemented

[English](2026-10-31-anthropic-encrypted-search-replay.md) | 中文

## 问题

Anthropic 提供商原生网页搜索结果包含不透明的加密内容。此前的对话历史发生变化后再重放此载荷，可能导致下一次提供商请求以 HTTP 400 失败，从而阻断对话。

## 决策

在出站消息整形期间，如果提供商执行的 `webSearch` 部分结果包含加密的 `web_search_result`，`toModelMessages` 会将整个部分从重放中移除。这样会同时移除配对的服务器工具调用和结果，并在 Anthropic SDK 序列化载荷之前完成；周围的消息部分仍会保留。

## 考虑过的替代方案

- 原样重放不透明载荷：对话历史编辑后，提供商可能会拒绝该载荷。
- 仅移除加密字段或结果块：这会留下格式错误的结果或未配对的服务器工具调用。
- 检查此前历史是否仍与载荷匹配：持久化结果中没有可用的有效性绑定信息。

## 影响

后续请求不再包含原始加密搜索结果，因此模型可能需要重新搜索以获取来源数据。助手的普通文本和无关工具结果仍会保留在重放历史中。

## 验证

- 回归测试 — `src/main/ai/messages/__tests__/messageRules.anthropicSerialization.test.ts`：通过本地 Anthropic 请求完成对话，不发送加密结果及其工具调用，同时保留相邻的助手文本。
