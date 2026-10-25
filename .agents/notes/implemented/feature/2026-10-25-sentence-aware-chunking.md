# Agent Note: Sentence-aware knowledge chunking

Status: implemented

English | [中文](2026-10-25-sentence-aware-chunking.zh.md)

## Problem

The knowledge splitter preferred Markdown headings, code fences, paragraphs, list items, and newlines, with a 22% look-back window and a hard cut at the token target. Sentence punctuation was not a break point, display and inline math and HTML tables were not protected, the token budget used one document-wide chars-per-token ratio, and overlap started at an arbitrary character.

On MinerU academic PDFs this produced chunks that ended mid-sentence, split LaTeX formulas or `<table>` blocks, started overlapping chunks in the middle of a sentence or formula, and exceeded the requested budget: a 1024-token target produced a 1718-token chunk. Retrieval evaluation showed the cost in multi-fact questions such as "which system model and which simulation software".

Edge cases in this decision are a code fence at offset zero, a fence inside a blockquote or list container, `$$` inside inline code, touching tables, and fenced code blocks larger than the token budget.

## Decision

`src/main/features/knowledge/pipeline/indexing/splitter.ts` now:

- Adds sentence break points for `。！？；…` and `.!?`, cutting after the punctuation and any closing quote.
- Treats `$$...$$`, inline `$...$`, and `<table>...</table>` as atomic regions. Break points inside are ignored. A cut that lands inside moves before the block; an overlap start inside moves after a non-code block or to the next line inside code.
- Pairs backtick and tilde fences at line starts, including offset zero, up to three leading spaces, and blockquote or list container prefixes (`> ~~~sh`, `- ```sh`, `1. ```sh`, nested `> >`). Also masks four-space or tab-indented code blocks before math detection. A code block that fits stays atomic; one larger than the budget is cut at line boundaries.
- Masks complete Markdown inline-code spans from display and inline math detection. Backtick runs pair by exact run length; backslash escaping applies only to prospective openers, so a closing run may follow a backslash. Unmatched or embedded runs do not suppress a later complete span. Fence delimiters are excluded start-inclusively, so two fences cannot create a false inline span across prose.
- Scans formula delimiters only outside code, tables, display math, and inline code. Excluded regions are skipped before a delimiter is consumed, so a `$` inside code does not consume a later formula opener.
- Falls back to the nearest sentence or structural boundary when the 22% window has none, allowing a small forward overshoot to the next sentence end.
- Checks each selected chunk with `estimateTokenCount`; when it exceeds the budget, it binary-searches the largest fitting prefix and prefers a sentence or structural boundary within that prefix.
- Snaps overlap starts inside split code blocks to a line boundary while preserving available overlap; otherwise it snaps forward to the next sentence or structural boundary, dropping overlap only when no boundary fits before the cut.
- Extends `delimiter` fallbacks with the other sentence punctuation. Atomic regions remain `structured`-only.

`contentText.slice(charStart, charEnd) === chunk.text` remains the invariant. `chunk.ts`, `tokenLimit.ts`, `localEmbeddingTokenLimit.ts`, and the index contract are unchanged.

## Alternatives considered

- LangChain `@langchain/textsplitters`: returns strings or documents without a reliable end offset after trimming. Keeping the verbatim offset contract would require a separate forward-cursor mapping, and Markdown/math atomicity would still be custom. Rejected for the production path.
- `@chonkiejs/core`: exact offsets and a simpler API, but character-based token sizing, no math/table atomic blocks, overlap not sentence-aligned, a pre-1.0 API, and an optional tree-sitter package of about 25 MB. On the same document it produced 9/21 chunks ending mid-prose and 3 chunks with unbalanced display math. Rejected.
- Punctuation-only rules without atomic blocks or per-chunk token fitting: leaves formula/table splits and the 1718-token overshoot in place. Insufficient.
- Treating every code fence as indivisible: a code-heavy document produced a 3,361-token chunk at a 1024-token target, which embedding models truncate. Rejected.
- Keeping token-based overlap: starts chunks mid-sentence when the overlap lands inside a sentence. Rejected.

## Consequences

- Chunks end and start on sentence or structural boundaries whenever a sentence fits the budget. A single sentence longer than `chunkSize` still requires a hard cut.
- Small code blocks, formulas, and tables stay intact. Fenced or indented code blocks larger than the budget are split at line boundaries; a single code line longer than the budget is hard-cut. A formula or table that itself exceeds the budget remains atomic, a known exception.
- Overlap starts inside a split code block move to the containing line's start when it remains after the preceding chunk start, preserving code context while avoiding mid-line starts. Overlap may shrink or disappear when no suitable boundary fits. Non-whitespace coverage is preserved.
- Token fitting uses `tokenx`. The local embedding tokenizer may differ, so `refineChunksByTokenLimit` remains the final guard for local models.
- Existing indexes must be reindexed to adopt the new boundaries.
- `structured` is the recommended strategy for MinerU and academic Markdown; `delimiter` keeps its previous atomic behavior.
- A standalone evaluation of 12 queries across `structured-1024-200`, `structured-512-100`, and `structured-300-50` reached Hit@5 12/12 for every config. `512/100` was the best balance (Hit@3 12/12), `1024/200` led Hit@1 and MRR (11/12, 0.933), and `300/50` lost rank on multi-fact questions.

## Verification

- Regression — `pnpm test:main src/main/features/knowledge/pipeline/indexing/__tests__/splitter.test.ts`: 39 tests pass, covering sentence punctuation and closing quotes, `$$`, inline math, tables, overlap starts, token fitting, a fence at offset zero, indented backtick and tilde fences, blockquote- and list-prefixed fences with prose after the closing fence, four-space-indented code, single- and multiline inline code with embedded backticks, a closing backtick after a backslash, escaped and unmatched backticks, a later code span after an embedded run, genuine math after code containing `$`, a formula between two fences, touching tables, oversized fenced and indented code blocks, line-aligned code overlap, and the verbatim fuzz invariant.
- Regression — `pnpm test:main src/main/features/knowledge/pipeline/indexing/__tests__/chunk.test.ts src/main/features/knowledge/pipeline/indexing/__tests__/tokenLimit.test.ts src/main/features/knowledge/pipeline/indexing/__tests__/localEmbeddingTokenLimit.test.ts src/main/features/knowledge/pipeline/vectorstore/indexStore/__tests__/KnowledgeIndexStore.integration.test.ts`: 10 tests pass, 49 with the splitter suite.
- Regression — `pnpm test:main src/main/features/knowledge`: 651 passed, 18 pre-existing path-mock failures identical to the original splitter baseline, 1 skipped.
- Regression — `oxfmt --check`, `oxlint --deny-warnings`, and `eslint` on the changed files pass.
- Regression — reviewer-style probes at `chunkSize=1024`, `chunkOverlap=200`: document-start fence max 1019 tokens; blockquote-prefixed fence max 1022; list-prefixed fence max 1020; ordered-list-prefixed fence max 1021; nested blockquote fence max 1014; three-space-indented blockquote fence max 1022; multiline inline-code `echo $$` max 1020; an embedded backtick followed by a later `echo $$` code span max 1020; a tilde fence containing `echo $$` max 1020; a two-space-indented tilde fence max 1019; an escaped backtick before a real span max 1020; an unmatched backtick before a double-backtick span max 1020; a closing backtick after a backslash max 1017; a four-space-indented `echo $$` block max 1019; 100 touching tables max 1023; a 160-line, 12.5k-character code block split into 3 chunks with max 1020 tokens; a 400-line code block retained line-aligned overlap at every boundary; a 200-line indented code block at `32/0` maxed at 32 tokens. Container-prefixed fence fixtures emit 16 chunks each and end every non-boundary chunk on a sentence terminator, so the literal `$$` inside the fence no longer opens a display-math region over the following prose. A formula following code containing `$` and a formula between two fences remain complete in one chunk. Non-whitespace coverage was 0 missing in every probe.
- Regression — non-whitespace coverage on the MinerU document: 0 missing characters; no chunk has unbalanced `$$` or `<table>` in `structured` mode.
- Regression — real embeddings (`voyageai/voyage-multimodal-3.5`, 2048 dimensions) and 12 queries: all answers are in the top 5 for all three configs; the ranking split above is reproduced.

