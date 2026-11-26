# Agent Note: Gemini tool signatures across Chat model switches

Status: implemented

English | [中文](2026-11-25-gemini-chat-tool-signature-replay.zh.md)

## Problem

After a completed tool call from Gemini 3.8 Flash, switching the same Chat to Gemini 4 Argon on CherryIN sends Flash's signature to Argon. Argon returns HTTP 400. The persisted reply carries the selected model ID, but the history sent to the AI SDK previously dropped it.

Switching provider connections can also make a signature on a previous text reply invalid, even with the same model slug.

## Decision

Pass the completed reply's model ID into the request history. The Gemini middleware compares it with the target model and marks signed client tool calls before the current user text for explicit omission when the model differs. The Google serializer omits the marked signature and keeps the call and result.

For signed text, the middleware matches the signature to its historical source and omits only the signature from the outgoing text part. The comparison includes the provider connection.

## Alternatives considered

Replacing the old signature with `skip_thought_signature_validator` still returned 400 in the Argon comparison. Omitting the field on the same request returned 200. Removing the entire call and result would discard context the target can accept.

## Consequences

Chat keeps the stored signature for replay to its original model. An unrecognized source or an ambiguous tool call ID keeps the existing replay behavior. The compatibility rule applies to the native Google Generate Content protocol.

## Verification

- Regression — `geminiHistorySignatureReplay.test.ts`: cross-model history retains text and paired tool history while omitting the old signatures. It also covers text-only history across provider connections with the same model slug and preserves signatures for same-model, current-turn, and unknown-source replay.
- Regression — `PersistentChatContextProvider.test.ts`: the completed reply's persisted model ID reaches the following request.
- Electron — On CherryIN, the Flash-to-Argon request keeps the paired tool history and omits the old signature. A repeat returned 200 after an initial 503. Flash-to-Flash requests returned 200 with the original signatures.
- Electron — On OpenRouter, Gemini 3.1 Flash Lite continued a tool call, then Gemini 4 Neon read that history and completed its own tool call. The successful requests carried the original `reasoning_details` without adding Google-compatible `extra_content`.
- Electron — AiHubMix to official Gemini with the same Gemini 3.1 Flash Lite slug returned 200 on the previously failing prompt. The request retained the historical text and tool pair while omitting the text signature. The original saved signature was still present.
