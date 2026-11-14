# Agent Note: Bounded attachment reads

Status: proposed

English | [中文](2026-11-10-attachment-bounded-reads.zh.md)

## Problem

On extraction-cache misses, chat attachments are read in full before the request budget is applied. `prepareChatMessages()` prepares every message with `Promise.all`, and each non-native attachment calls `extractDocumentText()`, which reads its whole body on a cache miss. Only afterwards does `applyInlineCaps()` decide how much text reaches the prompt ([`attachmentRouting.ts`](../../../../src/main/ai/messages/attachmentRouting.ts)). The request budget therefore limits the prompt, but not the bytes read, decoded, or cached.

The worker change in [the 2026-11-09 attachment preparation note](../../implemented/bug-fix/2026-11-09-attachment-preparation-workers.md) moved plain-text decoding and allocation off Electron main. It deliberately left input byte reads, full extracted-text caching, and PDF/Office parsing unchanged. Those are the remaining unbounded costs:

- `FileManager.read(..., { encoding: 'binary' })` loads the whole file into memory on an extraction-cache miss, including after the 30-minute TTL expires or the file version changes. An unchanged attachment with a valid cache entry returns its cached result without reading the body.
- `extractDocumentText()` caches the full extracted text for 30 minutes with no total byte capacity ([`attachmentTextExtraction.ts`](../../../../src/main/ai/messages/attachmentTextExtraction.ts)).
- `read_file` extracts the full text and then pages it, so page size limits the result, not the work ([`ReadFileTool.ts`](../../../../src/main/ai/tools/adapters/aiSdk/builtin/ReadFileTool.ts)).
- PDF and Office parsers run on main without a cancellation signal.

Work scales with source file size, not with the attachment allowance. An 11 MB Markdown file with a very long line can therefore cost full-file I/O and memory on a send that misses the extraction cache; cache hits reuse the extracted text. This note does not claim that this mechanism alone caused the crash in #22667.

## Proposal

Make the request budget govern reads, not only the prompt.

### Ordering

- `resolveAttachmentBudget()` already runs before `prepareChatMessages()` in `AiService`. Its result becomes a byte allowance for the request, converted with the same conservative UTF-8 bound the worker already uses.
- The allowance is split across the request's non-native text attachments with the existing `allocateAttachmentBudget` rule. Each file reads at most its share, including any encoding-detection sample and decoding look-ahead; these reads do not add an allowance beyond the share.
- Extraction never reads beyond that share for plain text. A file larger than its share gets a head excerpt and a truncation marker.

### Plain-text reads

- Read through `FileManager.readChunk(id, offset, length)`, which already exists, instead of loading the whole file.
- Decode incrementally. UTF-8 uses a streaming decoder that carries partial multi-byte sequences across chunks. Legacy encodings detect from a bounded leading sample and then decode the same way.
- A single long line is handled by the byte cursor, not by line scanning.

### Continuation cursor

- `read_file` keeps `offset`/`limit` as the model-facing contract, but the position is a byte offset into the file plus the version it was read from (`mtime`, `size`).
- If the version changed between pages, the tool returns an error that says the file changed, rather than mixing old and new text.
- Existing UTF-16 offsets from earlier truncation notes are accepted for one compatibility window and then retired (see Risks).

### Cache

- Extracted text is cached by `(entryId, mtime, size)` as it is today. A byte capacity is added, with least-recently-used eviction. The 30-minute TTL remains.
- Only extraction results within the bounded read are cached for plain text. Full-document results for PDF/Office keep their existing behavior until the follow-up Spec.

### Models without tools

- Models that cannot call `read_file` receive only the bounded head, with a truncation marker that does not mention continuation. This is the current behavior and is kept.

### Cancellation

- Abort stops further chunk reads and prevents queued worker tasks from starting. A running worker is terminated as it is now.

### Out of this Spec

PDF and Office parsing limits, page-wise PDF reads, and isolated execution for Office conversion need their own Spec. This note covers plain text, the budget ordering, the cache, the cursor, and cancellation. This split is a decision for approval; see Risks.

## Alternatives considered

- **Per-file size ceiling (for example 8 MiB, from PR #22670).** Rejected as the final design. It is closed and unmerged, bounds neither the total nor the time spent on accepted files, and several accepted files can still exhaust the request allowance. It may remain a temporary guard only if the migration needs one.
- **Keep whole-file reads and cache only.** Rejected. The CPU work moved by #23927 is not the only cost. On cache misses, full-file reads still scale with source size; the full-text cache also has no aggregate byte capacity.
- **Remove inline attachment text and rely on `read_file`.** Rejected. Models without tool calling would lose attachment content entirely, which changes behavior for every provider.
- **Utility process for all extraction.** Deferred. It fits Office conversion, which is not in this Spec. Plain-text decoding does not need a native crash boundary.

## Acceptance criteria

- AC1 — For an 11 MB plain-text attachment, all bytes read during preparation, including encoding-detection samples and decoding look-ahead, do not exceed the request's per-file allowance. (verification: unit, fake `FileManager` counting read bytes)
- AC2 — For many non-native text attachments in one request, the total bytes read across attachments, including encoding-detection samples and decoding look-ahead, and the inlined tokens do not exceed their respective request allowances. (verification: unit)
- AC3 — Chunked decoding matches whole-buffer decoding for multi-byte UTF-8 characters split across chunk boundaries, a single line larger than one chunk, and a legacy-encoded sample. (verification: unit)
- AC4 — Consecutive `read_file` pages are contiguous, with no lost or repeated characters. If the file's version changes between pages, the tool returns an explicit changed-file error. (verification: unit)
- AC5 — Aborting a request during a read or a queued worker task stops further reads and prevents the task from starting. (verification: unit)
- AC6 — The extraction cache never holds more than its byte capacity, and evicts least-recently-used entries first. The TTL still expires entries. (verification: unit)
- AC7 — A model that cannot call tools receives only the bounded head with a truncation marker and no continuation instruction. (verification: unit)
- AC8 — In a real Electron Chat send with an 11 MB single-line Markdown attachment and several attachments in history, bytes read and peak main-process memory stay within thresholds set at approval, and main event-loop lag does not grow with source size. (verification: Electron)

## Risks

- **Byte allowance versus tokens.** A UTF-8 byte bound is conservative for ASCII and prose, so less text is inlined than the window allows. This is the accepted cost from #23927.
- **Encoding detection.** Detecting a legacy encoding from a bounded sample can choose the wrong encoding for a file whose sample is unrepresentative. A wrong choice produces mojibake, not a crash. Detection must still fall back to the conservative null result when the sample is ambiguous.
- **Cursor compatibility.** Existing transcripts and truncation notes contain UTF-16 `offset=` values. Accepting both forms for one compatibility window adds code that must be removed later.
- **Version races.** A file replaced between pages is detected by version, but a file whose `mtime` and `size` do not change is not. This is accepted for the same reason the existing cache key accepts it.
- **Scope split.** Splitting PDF/Office into a follow-up Spec leaves the largest single-file costs in place after this layer. Approval should confirm that split or merge the two.
- **Thresholds in AC8.** The numeric limits are not chosen in this note. They must be set and measured before implementation is approved.

## Open decisions for approval

1. Keep PDF/Office in a follow-up Spec (proposed) or include them here.
2. The cache byte capacity value.
3. The AC8 thresholds for read bytes, peak memory, and event-loop lag.
4. Whether to keep UTF-16 `offset=` compatibility, and for how long.
