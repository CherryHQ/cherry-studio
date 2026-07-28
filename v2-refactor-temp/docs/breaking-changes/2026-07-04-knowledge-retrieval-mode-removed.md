---
title: Knowledge retrieval mode and hybrid alpha settings removed
category: changed
severity: notice
introduced_in_pr: '#16699'
date: 2026-07-04
---

## What changed

Knowledge base RAG settings no longer expose a search mode picker (vector / bm25 / hybrid) or a hybrid alpha slider. Retrieval mode is now derived automatically from whether the base has an embedding model: bases without one search BM25 only, and embedding-backed bases always use hybrid retrieval (BM25 + vector, fused with RRF). The relevance threshold setting remains available when a rerank model is selected and is applied only to relevance-scored reranked results. Migrated v1 bases lose any previously configured search mode or hybrid alpha, but valid threshold values are preserved.

## Why this matters to the user

Users who previously pinned a base to vector-only search or set a custom hybrid alpha will no longer find those controls in the base's RAG settings panel. Search results for such bases may change because embedding-backed bases now use hybrid retrieval with RRF instead of a tunable alpha. Threshold controls remain visible only for bases with a rerank model, where the scores are comparable relevance scores.

## What the user should do

Nothing — automatic. Retrieval mode is now fully determined by whether the base has an embedding model configured. To keep using threshold filtering, select a rerank model for the knowledge base.

## Notes for release manager

`docs/references/knowledge/knowledge-service.md` was updated in this PR to describe the new automatic retrieval derivation.
