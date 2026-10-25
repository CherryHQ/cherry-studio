# Agent Note: Sentence-aware knowledge chunking

Status: implemented

English | [中文](2026-10-25-sentence-aware-chunking.zh.md)

## Problem

The knowledge splitter preferred Markdown headings, code fences, paragraphs, list items, and newlines, with a 22% look-back window and a hard cut at the token target. Sentence punctuation was not a break point, display and inline math and HTML tables were not protected, the token budget used one document-wide chars-per-token ratio, and overlap started at an arbitrary character.

On MinerU academic PDFs this produced chunks that ended mid-sentence, split LaTeX formulas or `<table>` blocks, started overlapping chunks in the middle of a sentence or formula, and exceeded the requested budget: a 1024-token target produced a 1718-token chunk. Retrieval evaluation showed the cost in multi-fact questions such as "which system model and which simulation software".

## Decision

`src/main/features/knowledge/pipeline/indexing/splitter.ts` now:

- Adds sentence break points for `。！？；…` and `.!?`, cutting after the punctuation and any closing quote.
- Treats `$$...$$`, inline `$...$`, and `<table>...</table>` as atomic regions. Break points inside are ignored, a cut that lands inside moves before the block, and an overlap start inside moves after it.
- Falls back to the nearest sentence or structural boundary when the 22% window has none, allowing a small forward overshoot to the next sentence end.
- Checks each selected chunk with `estimateTokenCount`; when it exceeds the budget, it binary-searches the largest fitting prefix and prefers a sentence or structural boundary within that prefix.
- Snaps an overlap start forward to the next sentence or structural boundary, dropping the overlap when no boundary fits before the cut.
- Extends `delimiter` fallbacks with the other sentence punctuation. Atomic regions remain `structured`-only.

`contentText.slice(charStart, charEnd) === chunk.text` remains the invariant. `chunk.ts`, `tokenLimit.ts`, `localEmbeddingTokenLimit.ts`, and the index contract are unchanged.

## Alternatives considered

- LangChain `@langchain/textsplitters`: returns strings or documents without a reliable end offset after trimming. Keeping the verbatim offset contract would require a separate forward-cursor mapping, and Markdown/math atomicity would still be custom. Rejected for the production path.
- `@chonkiejs/core`: exact offsets and a simpler API, but character-based token sizing, no math/table atomic blocks, overlap not sentence-aligned, a pre-1.0 API, and an optional tree-sitter package of about 25 MB. On the same document it produced 9/21 chunks ending mid-prose and 3 chunks with unbalanced display math. Rejected.
- Punctuation-only rules without atomic blocks or per-chunk token fitting: leaves formula/table splits and the 1718-token overshoot in place. Insufficient.
- Keeping token-based overlap: starts chunks mid-sentence when the overlap lands inside a sentence. Rejected.

## Consequences

- Chunks end and start on sentence or structural boundaries whenever a sentence fits the budget. A single sentence longer than `chunkSize` still requires a hard cut.
- Formula and table blocks stay intact. An atomic block that starts at the chunk start may exceed the budget; atomicity wins in that case.
- Token fitting uses `tokenx`. The local embedding tokenizer may differ, so `refineChunksByTokenLimit` remains the final guard for local models.
- Overlap may shrink or disappear when no boundary fits. Non-whitespace coverage is preserved.
- Existing indexes must be reindexed to adopt the new boundaries.
- `structured` is the recommended strategy for MinerU and academic Markdown; `delimiter` keeps its previous atomic behavior.
- A standalone evaluation of 12 queries across `structured-1024-200`, `structured-512-100`, and `structured-300-50` reached Hit@5 12/12 for every config. `512/100` was the best balance (Hit@3 12/12), `1024/200` led Hit@1 and MRR (11/12, 0.933), and `300/50` lost rank on multi-fact questions.

## Verification

- Regression — `pnpm test:main src/main/features/knowledge/pipeline/indexing/__tests__/splitter.test.ts`: 22 tests pass, covering sentence punctuation and closing quotes, `$$`, inline math, tables, overlap starts, token fitting, and the verbatim fuzz invariant.
- Regression — `pnpm test:main src/main/features/knowledge/pipeline/indexing/__tests__/chunk.test.ts src/main/features/knowledge/pipeline/indexing/__tests__/tokenLimit.test.ts src/main/features/knowledge/pipeline/indexing/__tests__/localEmbeddingTokenLimit.test.ts src/main/features/knowledge/pipeline/vectorstore/indexStore/__tests__/KnowledgeIndexStore.integration.test.ts`: 10 tests pass, 32 with the splitter suite.
- Regression — `pnpm test:main src/main/features/knowledge`: 600 passed, 18 pre-existing path-mock failures identical to the original splitter baseline, 1 skipped.
- Regression — `oxfmt --check`, `oxlint --deny-warnings`, and `eslint` on the changed files pass.
- Regression — non-whitespace coverage on the MinerU document: 0 missing characters; no chunk has unbalanced `$$` or `<table>` in `structured` mode.
- Regression — real embeddings (`voyageai/voyage-multimodal-3.5`, 2048 dimensions) and 12 queries: all answers are in the top 5 for all three configs; the ranking split above is reproduced.
