# Agent Note: Gemini tool-call history names repaired so calls pair with results

Status: implemented

English | [中文](2026-10-28-gemini-tool-call-history-names-repaired.zh.md)

## Problem

Replaying a stored conversation that contained completed tool calls caused `@ai-sdk/google` to serialize
`functionCall` / `functionResponse` parts whose `name` was absent (`missing name`) or mismatched
(`name "kb_list" does not match name "kb_search" at …`). The provider rejected the entire turn
with HTTP 400 `invalid Gemini function call history`, blocking the conversation permanently.
Reported as #22577 (two desktop diagnostics: `contents[455]` and `contents[55]`/`contents[56]`).

The fault was in how Cherry rebuilt the tool-call history for the Gemini request:

- A stored `dynamic-tool` part could lose its `toolName` (migration, manual edit, or the
  approval-bridge path that persisted the name in `callProviderMetadata.cherry.toolName`
  instead of on the part itself).
- `@ai-sdk/google` names each wire part directly from the part; it has no tool-call id it can
  match on, so the call/result pair falls out of sync when one half lacks a name or carries a
  different one.
- The existing sanitizer `sanitizeDynamicToolNames` only rewrites wire-illegal names, it never
  adds a missing one or synchronizes a mismatched pair.

## Decision

Add a new pipeline step `repairToolNames` (running before `sanitizeDynamicToolNames`) that
recovers the real name for every `dynamic-tool` part whose name survives elsewhere, and rewrites
the part so both halves of the pair emit the same legal name.

Recovery order per part:

1. `part.toolName` (the canonical field on a dynamic tool part).
2. `part.callProviderMetadata?.cherry?.toolName` (the approval bridge's pre-finalize copy).

If neither is present, the part stays nameless and the sanitizer drops it before conversion —
#23233's accepted tradeoff, since an invented placeholder cannot identify the original tool. If a
recovered name is wire-illegal and not a declared tool, it is rewritten by `toWireToolName` —
exactly what the sanitizer does — making this step idempotent with the existing contract.

Recovery runs before the sanitizer so an empty `toolName` never shadows the real name still
carried in provider metadata, and a recovered declared name still routes the output through the
tool's `toModelOutput`.

Static `tool-{name}` parts are left untouched: their name is their type, which is already what the
SDK emits.

Pipeline order (documented in the `toModelMessages` JSDoc):

```
… → repair recoverable tool-call names → make remaining undeclared names wire-legal, dropping
    any still nameless → strip media the model can't accept → …
```

## Alternatives considered

- Keep the original `unknown_tool` placeholder for names that survive nowhere: rejected after
  #23233 landed upstream — an invented identity cannot match a tool declaration, so unrecoverable
  pairs are dropped there instead. This repair now covers only names that genuinely survive (the
  approval-bridge metadata case #23233 would otherwise drop and lose), and defers the rest to the
  sanitizer's drop.
- Fail with a structured error instead of repairing: rejected because the history is already
  stored; a hard failure offers no recovery path and the user cannot fix it.
- Scope the repair to Gemini only: rejected because the same name-consistency invariant is useful
  for any provider that names call/result from the part, and the repair is harmless for providers
  that match on `toolCallId` instead.

## Consequences

- A conversation that replays a completed tool call no longer produces `invalid Gemini function
  call history` (HTTP 400).
- Emitted history keeps each function call's `name` equal to the name of its paired result,
  including entries restored from storage.
- An entry whose stored name is missing but recoverable is repaired client-side with its real
  name; an entry with nothing recoverable is dropped from the replay (#23233's behavior) instead
  of being sent as an invalid history.
- N tool calls in history produce N consistent call/result pairs for the Gemini request (asserted
  by regression test `messageRules.geminiToolNames.test.ts`).

## Verification

- Regression — `messageRules.geminiToolNames.test.ts`: 15 tests, 7 of them capturing the wire
  bytes `@ai-sdk/google` would send (`generateText` fetch bodies); all pass on the merged head.
- Existing suites on the merged head: `src/main/ai/messages/` 240 tests pass (including the
  #23233 empty-name drop regression); `src/main/ai/runtime/aiSdk/` 597 tests pass.
- `oxlint --deny-warnings`, `oxfmt --check`, and `tsc --noEmit` are left to CI on the merged head.
- No public API surface change; the repair is internal to the `toModelMessages` pipeline.