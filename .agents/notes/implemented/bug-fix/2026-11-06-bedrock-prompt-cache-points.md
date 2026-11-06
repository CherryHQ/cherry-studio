# Agent Note: Bedrock Claude requests carry Converse cache points

Status: implemented

English | [中文](2026-11-06-bedrock-prompt-cache-points.zh.md)

## Problem

`anthropicCacheFeature` runs for every AWS Bedrock model, because the `aws-bedrock` preset's only chat endpoint is `anthropic-messages`. It writes `providerOptions.anthropic.cacheControl`, but Bedrock requests go through `@ai-sdk/amazon-bedrock` (Converse), which reads only `providerOptions.bedrock.cachePoint`. Bedrock requests therefore carried no cache point, and Bedrock never cached a prompt even though caching is on by default.

## Decision

`bedrockAnthropicCacheFeature` runs directly after `anthropicCacheFeature` for Claude models on Bedrock. It copies each marker to a message-level `bedrock.cachePoint` on the message that holds it: `{ type: 'default' }`, plus `ttl: '1h'` only when every marker in that message is one hour and the model supports it. AWS lists only the five-minute lifetime for Claude Opus 4.1, so Opus 4.1 keeps five-minute cache points when one hour is selected. It reads the same holders `clampCacheMarkers` counts, so the four-breakpoint budget carries over. Claude is detected from the model id after stripping the Bedrock region and vendor prefix.

## Alternatives considered

- Part-level cache points: `@ai-sdk/amazon-bedrock` 4.0.96 ignores them, and newer 4.x versions read both levels, so writing both would double the points.
- Converting for every Bedrock model: Bedrock rejects a cache point on models without prompt caching ("You invoked an unsupported model or your request did not allow prompt caching", measured on Llama 3.3 70B, Ministral 3 8B, Qwen3 32B and gpt-oss-20b), which would break those chats.
- Including Amazon Nova: it accepts five-minute points but rejects `ttl: '1h'` ("Extended TTL prompt caching is only supported for Anthropic models"), so it is left for a separate change.
- `isAnthropicModel`: it does not match prefixed Bedrock ids such as `global.anthropic.claude-sonnet-4-6`.

## Consequences

Claude requests on Bedrock now cache under the existing `cacheControl` settings. The tool-definition marker has no equivalent in the installed SDK; tool definitions still sit inside the cached system prefix. Other Bedrock models keep today's request shape. Do not widen the model gate without first checking that the model accepts cache points.

## Verification

- Regression — `src/main/ai/runtime/aiSdk/params/features/__tests__/bedrockAnthropicCache.test.ts`: the real `@ai-sdk/amazon-bedrock` request body carries cache points after the system prompt and trailing messages, keeps the one-hour lifetime where supported and falls back to five minutes for Opus 4.1, never exceeds four points, and stays off for non-Claude ids.
- Regression — `src/main/ai/runtime/aiSdk/params/features/__tests__/internalFeatures.test.ts`: the feature activates only for Claude on Bedrock with caching enabled, directly after `anthropic-cache`.
