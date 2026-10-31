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

Add a new pipeline step `repairToolNames` (running after `sanitizeDynamicToolNames`, before media
gating) that recovers a name for every `dynamic-tool` part and rewrites the part so both halves of
the pair emit the same legal name.

Recovery order per part:

1. `part.toolName` (the canonical field on a dynamic tool part).
2. `part.callProviderMetadata?.cherry?.toolName` (the approval bridge's pre-finalize copy).

If neither is present, the part receives the plain placeholder `unknown_tool`. If a recovered name
is wire-illegal and not a declared tool, it is rewritten by `toWireToolName` — exactly what the
sanitizer does — making this step idempotent with the existing contract.

The placeholder is not digested: it is a legal wire name (`/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/`) and
is human-readable in logs. Parallel unnamed calls are distinguishable by their `toolCallId` and
`args`, so the placeholder is shared only across the call/result pair, not across distinct calls.

Static `tool-{name}` parts are left untouched: their name is their type, which is already what the
SDK emits.

Pipeline order (documented in the `toModelMessages` JSDoc):

```
… → make legacy v1 tool names wire-legal → repair missing/unmatchable tool-call names →
    strip media the model can't accept → …
```

## Alternatives considered

- Drop the whole call/result pair when a name is missing: rejected because it silently rewrites
  history, losing the tool execution evidence the user (and the model) expects to see.
- Fail with a structured error instead of a placeholder: rejected because the history is already
  stored; a hard failure offers no recovery path and the user cannot fix it.
- Digest the placeholder (e.g., `unknown_tool_5cf2b45d`): rejected because an opaque digest is
  harder to grep in logs and cannot be hand-corrected if the user wants to restore the real name.
- Scope the repair to Gemini only: rejected because the same name-consistency invariant is useful
  for any provider that names call/result from the part, and the repair is harmless for providers
  that match on `toolCallId` instead.

## Consequences

- A conversation that replays a completed tool call no longer produces `invalid Gemini function
  call history` (HTTP 400).
- Emitted history keeps each function call's `name` equal to the name of its paired result,
  including entries restored from storage.
- An entry whose stored name is missing is repaired client-side with `unknown_tool` instead of
  being sent as an invalid history.
- N tool calls in history produce N consistent call/result pairs for the Gemini request (asserted
  by regression test `messageRules.geminiToolNames.test.ts`).

## Verification

- Regression — `messageRules.geminiToolNames.test.ts`: 9 tests capture the wire bytes `@ai-sdk/google` would send (`generateText` fetch bodies); all fail without the fix (7/8), all pass with it.
- Existing suites: `src/main/ai/messages/` 228 tests pass; `src/main/ai/runtime/aiSdk/` 749 tests
  pass (one flaky timeout test now runs in 15s vs 20s limit).
- `oxlint --deny-warnings`, `oxfmt --check`, and `tsc --noEmit` (ignoring pre-existing
  workspace-link errors) pass on the changed files.
- No public API surface change; the repair is internal to the `toModelMessages` pipeline.