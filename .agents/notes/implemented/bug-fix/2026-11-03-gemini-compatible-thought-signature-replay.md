# Agent Note: Preserve Gemini signatures on compatible replay

Status: implemented

English | [中文](2026-11-03-gemini-compatible-thought-signature-replay.zh.md)

## Problem

The generic compatible SDK stores a tool signature under its configured provider namespace, but its serializer reads the canonical Google or compatible wire namespace. Replay could replace a real signature with the validation bypass sentinel.

## Decision

For Gemini 3/4 chat completions on the generic compatible adapter, replay selects the canonical signature, then the wire signature, then the configured namespace signature. It projects the latter into the wire field before the existing sentinel fallback, preserving unrelated wire fields. Invalid signature fields are removed from copies so they cannot shadow the fallback. No signatures are shared between calls.

## Alternatives considered

Writing the configured signature to canonical Google would cause the SDK to replace the entire `extra_content` object. Scanning other namespaces could replay a foreign signature. Both are rejected. The separate [Pi identity decision](2026-10-29-pi-google-replay-identity.md) remains in force.

## Consequences

The original namespace and other options remain intact. This does not establish cross-model signature identity or alter native Google and Pi replay.

## Verification

- AC1 — `geminiThoughtSignatureReplay.test.ts`: a real signature stored under the connection namespace reaches `tool_calls[].extra_content.google.thought_signature` in the final body instead of the sentinel.
- AC2 — same file: the projection runs per request through the registered chain and keeps no request-scoped state, so a follow-up step re-reads the same stored signatures.
- AC3 — all four reported model ids fall back to the sentinel on the final body when no real signature exists.
- AC4 — a real canonical signature wins and is written unchanged.
- AC5 — a real wire signature survives when `extra_content` carries sibling fields.
- AC6 — a real wire signature survives a sentinel or non-string canonical value.
- AC7 — projected values reach the wire while sibling `extra_content` and `google` fields stay intact.
- AC8 — a foreign provider namespace alone does not supply a signature; the sentinel fallback applies.
- AC9 — empty, blank, non-string and sentinel values fall back instead of reaching the body.
- AC10 — invalid canonical and wire values cannot shadow the fallback.
- AC11 — each tool call keeps its own signature, and ids stay aligned with their tool results.
- AC12 — deep-frozen prompts are not mutated and repeated requests do not inherit earlier signatures.
- AC13 — non-Gemini models and non-chat-completions endpoints do not receive the projected field.
- AC14 — text and reasoning signatures are never moved onto a tool call.
- AC15 — `internalFeatures.test.ts` asserts the activation gates, the order before the skip feature, and the real `sdkConfig.providerOptionsKey` namespace.
- Regression — `node node_modules/vitest/vitest.mjs run --project main` over the four feature/params files plus `piGoogleReplay.test.ts`: 5 files, 202 tests pass; the Pi and native foreign/unsigned boundaries are unchanged.
