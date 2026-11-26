# Agent Note: 处理 Anthropic thinking 前缀不匹配

Status: implemented

[English](2026-11-24-anthropic-thinking-prefix.md) | 中文

## 问题

Cherry Studio 编辑或压缩历史、重新组装系统提示词或调整工具列表时，可能改变发给模型的前缀。Anthropic 可能拒绝回传绑定在旧前缀上的 thinking 的请求。 [Issue #21990](https://github.com/CherryHQ/cherry-studio/issues/21990)

## 决策

即使显示文本为空，也保留带签名的 thinking 和 redacted thinking 供后续回传。对直连 Claude Messages API、回传历史 thinking 且使用受支持模型和 adaptive 模式的请求，使用 SDK 原生的 `drop_block` 选项。API 使用原始签名校验。显式设置的绑定策略优先，调用方自管的请求与兼容网关沿用已有配置。 [Anthropic 前缀校验](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks)

请求内压缩或滑动窗口裁剪替换前缀时，从改写后的请求中移除已生成的 Anthropic thinking，涵盖 CherryIN 和 AiHubMix 的 Anthropic Messages 路由，并保留正文和工具历史。后续步骤沿用同一压缩前缀时，可以回传新生成的 thinking。

## 考虑过的方案

- 客户端指纹需要模拟服务商的规范化规则，同时给推理块持久化额外的元数据。
- 向所有兼容端点发送 beta，要求每个网关都支持并透传这个选项。
- 在系统提示词和工具变更时仍保持完全追加式的会话，需要单独定义模型请求历史的契约。

## 影响

自动启用的服务端选项覆盖官方 Claude API 中受支持的 adaptive 模式。其他请求在编辑历史、切换模型、修改系统提示词或调整工具后，仍可能遇到前缀不匹配。 [Issue #21990](https://github.com/CherryHQ/cherry-studio/issues/21990)

## 验证

- Regression — Anthropic 请求边界测试通过锁定版本的 SDK 序列化器校验 beta header、原始签名块、适用模式，以及兼容端点和调用方自管请求的例外。
- Regression — 同一组测试还校验空文本签名块和 redacted thinking 能通过历史序列化，客户端压缩后的请求保留正文以及配对的工具调用和结果。
- Regression — Electron 实测 AiHubMix Claude Haiku 4.5，正常续聊回传两个签名 thinking 块，滑动窗口裁剪后回传零个。两次请求都保留了续聊所需的答案，并返回 HTTP 200。
