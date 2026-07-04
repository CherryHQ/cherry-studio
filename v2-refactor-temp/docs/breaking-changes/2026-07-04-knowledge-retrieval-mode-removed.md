---
title: Knowledge retrieval mode, relevance threshold, and hybrid alpha settings removed
category: changed
severity: notice
introduced_in_pr: '#16699'
date: 2026-07-04
---

## What changed

Knowledge base RAG settings no longer expose a search mode picker (vector / bm25 / hybrid), a relevance threshold slider, or a hybrid alpha slider. Retrieval mode is now derived automatically from whether the base has an embedding model: bases without one search BM25 only, and embedding-backed bases always use hybrid retrieval (BM25 + vector, fused with RRF). Migrated v1 bases lose any previously configured search mode, threshold, or hybrid alpha and adopt this same automatic behavior.

## Why this matters to the user

Users who previously pinned a base to vector-only search, tuned a relevance threshold, or set a custom hybrid alpha will no longer find those controls in the base's RAG settings panel. Search results for such bases may change: there is no longer a relevance-threshold cutoff, and hybrid fusion always uses RRF instead of a tunable alpha.

## What the user should do

Nothing — automatic. There is no replacement control; retrieval mode is now fully determined by whether the base has an embedding model configured.

## Notes for release manager

`docs/references/knowledge/knowledge-service.md` was updated in this PR to describe the new automatic retrieval derivation.
