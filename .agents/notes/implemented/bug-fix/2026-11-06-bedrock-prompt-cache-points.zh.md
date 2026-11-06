# Agent Note: Bedrock 上的 Claude 请求携带 Converse 缓存点

Status: implemented

[English](2026-11-06-bedrock-prompt-cache-points.md) | 中文

## 问题

`aws-bedrock` 预设唯一的对话端点是 `anthropic-messages`，因此 `anthropicCacheFeature` 会对每个 AWS Bedrock 模型生效。它写入的是 `providerOptions.anthropic.cacheControl`，但 Bedrock 请求经由 `@ai-sdk/amazon-bedrock`（Converse），该适配器只读取 `providerOptions.bedrock.cachePoint`。结果 Bedrock 请求不带任何缓存点，即使缓存默认开启，Bedrock 也从未缓存过提示词。

## 决策

`bedrockAnthropicCacheFeature` 紧跟在 `anthropicCacheFeature` 之后，仅对 Bedrock 上的 Claude 模型生效。它把每个标记复制为所在消息上的消息级 `bedrock.cachePoint`：`{ type: 'default' }`，只有当该消息中的所有标记都是一小时且模型支持时才加上 `ttl: '1h'`。AWS 对 Claude Opus 4.1 只列出五分钟有效期，因此选择一小时时 Opus 4.1 仍使用五分钟缓存点。它读取的位置与 `clampCacheMarkers` 计数的位置相同，因此四个断点的预算同样成立。Claude 模型通过去掉 Bedrock 区域和厂商前缀后的模型 ID 识别。

## 考虑过的替代方案

- 部件级缓存点：`@ai-sdk/amazon-bedrock` 4.0.96 会忽略它们，而较新的 4.x 版本两个层级都会读取，同时写入会让缓存点数量翻倍。
- 对所有 Bedrock 模型转换：Bedrock 会拒绝不支持提示词缓存的模型上的缓存点（"You invoked an unsupported model or your request did not allow prompt caching"，已在 Llama 3.3 70B、Ministral 3 8B、Qwen3 32B 和 gpt-oss-20b 上实测），这会导致这些对话失败。
- 包含 Amazon Nova：它接受五分钟缓存点，但拒绝 `ttl: '1h'`（"Extended TTL prompt caching is only supported for Anthropic models"），因此留待单独的变更处理。
- `isAnthropicModel`：它无法匹配带前缀的 Bedrock ID，例如 `global.anthropic.claude-sonnet-4-6`。

## 影响

Bedrock 上的 Claude 请求现在会按照现有的 `cacheControl` 设置进行缓存。工具定义上的标记在已安装的 SDK 中没有对应写法；工具定义仍位于已缓存的系统前缀之内。其他 Bedrock 模型的请求形态保持不变。在确认模型接受缓存点之前，不要放宽模型判断条件。

## 验证

- Regression — `src/main/ai/runtime/aiSdk/params/features/__tests__/bedrockAnthropicCache.test.ts`：真实的 `@ai-sdk/amazon-bedrock` 请求体在系统提示词和末尾消息之后携带缓存点，在支持的模型上保留一小时有效期，对 Opus 4.1 回退为五分钟，缓存点不超过四个，且对非 Claude 模型 ID 不生效。
- Regression — `src/main/ai/runtime/aiSdk/params/features/__tests__/internalFeatures.test.ts`：该功能仅在 Bedrock 上的 Claude 且缓存开启时生效，并紧跟在 `anthropic-cache` 之后。
