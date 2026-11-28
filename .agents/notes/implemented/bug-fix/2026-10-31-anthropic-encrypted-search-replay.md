# Agent Note: Anthropic encrypted web-search results are not replayed

Status: implemented

English | [中文](2026-10-31-anthropic-encrypted-search-replay.zh.md)

## Problem

Anthropic provider-native web-search results carry opaque encrypted content. Replaying that payload after earlier conversation history changes can make the next provider request fail with HTTP 400, blocking the conversation.

## Decision

During outbound message shaping, `toModelMessages` omits a complete provider-executed `webSearch` part when its result contains an encrypted `web_search_result`. This removes the paired server-tool call and result together, before the Anthropic SDK serializes the payload; surrounding message parts remain available.

## Alternatives considered

- Replay the opaque payload unchanged: the provider can reject it after history edits.
- Remove only the encrypted field or result block: this leaves a malformed result or an unmatched server-tool call.
- Check whether the prior history still matches the payload: no validity binding is available in the persisted result.

## Consequences

Follow-up requests no longer include the original encrypted search result, so the model may need to search again for its source data. The assistant's ordinary text and unrelated tool results remain in replay history.

## Verification

- Regression — `src/main/ai/messages/__tests__/messageRules.anthropicSerialization.test.ts`: completes a loopback Anthropic request without the encrypted result or its tool call, while preserving adjacent assistant text.
