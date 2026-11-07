# Agent Note: Bound attachment token counting and verify fitting prefixes

Status: implemented

English | [中文](2026-10-29-attachment-token-count-bounds.zh.md)

## Problem

The reporter's diagnostic stack is `RegExpStringIterator.next → BytePairEncodingCore.countNative → GptEncoding.countTokens → allocateInlineCaps → applyInlineCaps → prepareChatMessages → AiService.streamText`: a normal chat turn failed with `RangeError: Maximum call stack size exceeded` before the stream started. On the pre-fix head the call was unbounded and unguarded: whole attachment bodies (`attachmentBudget.ts:79`) and half-body binary-search prefixes (`:125`) went straight to the dependency's o200k `countTokens`, and nothing between `applyInlineCaps` and `AiService.streamText` caught a throw, so a local exception rejected request preparation.

Measured cold cost of one whole-body count: 50 000 identical characters ≈ 0.6 s, 200 000 ≈ 10 s, 400 000 ≈ 42 s; at 400 000 every shape tried also exceeded an 8 s wall clock. Separately, `charCapFor` assumed that backing off a surrogate pair cannot add tokens. It can: `"\uFFFD".repeat(7) + "😀" + "x".repeat(7)` is 16 units with a whole-body cost of 5; a 1-token allocation returned 7 units that cost 2.

The reporter's exact attachment is unavailable; the `RangeError` itself was **not** reproduced here (ten text shapes × 200 k–8 M chars, default and reduced stack size).

## Decision

In `src/main/ai/tokens/textTokenizer.ts`, the o200k adapter keeps its public shape (`TextTokenizer` with `id` and `count`, lazy ranks loading, `disallowedSpecial: new Set()`) and applies a private 16 384 UTF-16-unit cutoff: longer text is priced by its UTF-8 byte length without calling the encoder, shorter text keeps the exact count, and any exception from the dependency is answered with the byte length. The byte length bounds this byte-BPE above because every ordinary token covers at least one UTF-8 byte; it was checked against ASCII, CJK, emoji, lone-surrogate and chunk-boundary text.

In `src/main/ai/messages/attachmentBudget.ts`, `charCapFor` keeps the measured prefix search and the whole-fit fast path, then normalises the candidate cut through the existing `surrogateSafeEnd` helper (repeatedly, so a trailing run of unpaired high surrogates is stable), counts that prefix and accepts it only when it costs at most the allocation, otherwise halves it and re-checks; zero is the terminating safe result. The contract is a verified fitting prefix, not the largest fitting prefix.

The shared water-filling allocator, the pool derivation with `ATTACHMENT_INPUT_SAFETY_RATIO`, the UTF-16 continuation offsets and wording, `READ_FILE_PAGE_SIZE`, routing's deliberate absence of a recovery catch, `tokenx`, dialect dispatch and lazy loading are unchanged.

## Alternatives considered

- Summing counts over 16 384-unit chunks: rejected because it can undercount — a 16 410-unit body (`"\n"` × 16 383 + `" abc…xyz"`) counts 1 030 whole versus 1 027 chunked, which is the unsafe direction for a token ceiling.
- `gpt-tokenizer`'s `isWithinTokenLimit`: rejected as a bounded-work mechanism, since it still took 41 s at limit 100 000 on 400 000 spaces.
- Falling back to a flat `READ_FILE_PAGE_SIZE` per file when allocation fails: rejected because it reintroduces the per-file floor the shared pool replaced.
- Moving the count to a worker: out of scope for this fix.

## Consequences

### Impact

Every openai-dialect string longer than 16 384 units is byte-priced: about 4.9× the real count on ASCII prose (102 168 bytes versus 20 899 tokens), more on compressible whitespace. That applies to system prompts, history, tool text and gateway estimates as well as attachment bodies, so oversized requests inline a smaller head and exhaust the pool earlier; for non-tool models the head is simply smaller.

Strings at or below the cutoff keep exact counts, and a slow-but-successful count below the cutoff remains possible and is out of scope. No claim of provider-exact counting is added; the existing safety ratio is unchanged.

## Verification

- Regression — The four contract test files (`tokens/__tests__/textTokenizer.test.ts`, `tokens/__tests__/footprint.test.ts`, `messages/__tests__/attachmentBudget.test.ts`, and the new `messages/__tests__/attachmentRouting.tokenCounting.test.ts`) fail 15 of 64 assertions on the pre-fix head (production code at `0dd8cf3`, tests copied in) and pass 64/64 on this branch.
- Regression — One real-adapter RED is deterministic: `"A".repeat(16_385)` counts 2 049 before and 16 385 after.
- Regression — The consumer set (profiles, routing, ReadFileTool, gateway fallbacks, in-loop compaction, shouldDefer) stays green, as do ESLint, Oxlint, Oxfmt and the node typecheck.

Cold adapter measurements: a 400 000-character body that exceeded an 8 s wall before now returns its byte-priced count in under a millisecond.
