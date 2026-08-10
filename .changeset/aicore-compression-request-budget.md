---
'@cherrystudio/ai-core': patch
---

Budget the compaction request itself, and stop masking an empty summary.

Compaction protects the context window, but the summarize call is a window-bound request too — and it was neither budgeted on input nor sized on output:

- `createCompressionAdapter` hardcoded `maxOutputTokens: 2048`. The compaction prompt asks for an `<analysis>` scratchpad *and* a `<summary>` block, and on a reasoning model the thinking tokens are billed against that same budget and emitted before any text. Measured against `deepseek-v4-flash`, one compression needed 2233 output tokens, so the budget ran out mid-thinking and the model returned no text. The budget is now derived from the compression model's window via `resolveCompressionOutputTokens()` (25% of the window, clamped to 4096–16384) and overridable per call with `maxOutputTokens`.
- An empty model output was replaced with a `'[Compression produced no output]'` placeholder. Both callers already fail open on an empty summary (`compactHistory` keeps the history; hosts serve the un-compacted view), but the placeholder made the summary look non-empty, so those guards never fired and the folded turns were dropped behind the placeholder. The adapter now returns the model's output verbatim, empty included.
- `summarizeHistory` gains `maxInputTokens`: tool results are stubbed progressively until the estimated input fits, and if stubbing everything still isn't enough the slice is clamped (keeping the first message — often the accumulated prior summary — plus the most recent turns) with an in-band note about what was omitted.
