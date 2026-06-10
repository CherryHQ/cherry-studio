---
title: Per-knowledge-base result count and relevance threshold moved to per-search
category: changed
severity: breaking
introduced_in_pr: TBD
date: 2026-06-10
---

## What changed

A knowledge base no longer stores its own `documentCount` (number of results) or `threshold` (relevance cutoff). Those two "Search settings" controls are gone from the knowledge base config UI, and the values are no longer persisted per base.

Both knobs are now decided **per search** instead: the built-in `kb__search` agent tool exposes `topK` (replacing `documentCount`) and `threshold` as optional per-query parameters; when omitted, the service applies sensible defaults.

The local REST API server is aligned to the same naming and bounds: `POST /knowledge-bases/search` renames its request-body field `document_count` → `top_k`, raises its ceiling `20` → `50` and its default `5` → `10` to match the `kb__search` tool's `topK` (50) and the service default (`KNOWLEDGE_SEARCH_DEFAULT_TOP_K = 10`). The value is now actually forwarded to the search as the per-base `topK`, so a single-base request can return up to `top_k` results instead of being silently capped at the service default.

The hybrid-search weight (`hybridAlpha`, keyword-vs-semantic balance) is **unchanged** — it remains a per-base setting with its slider in the RAG config (shown only in hybrid search mode). The base also still keeps its `searchMode` (hybrid / bm25 / vector).

## Why this matters to the user

- Anyone who had tuned a knowledge base's result count or relevance threshold will find those two controls removed from the base settings, and their saved values are not carried forward.
- During v1 → v2 migration, the old `threshold` and `documentCount` on a v1 knowledge base are **not** migrated; every base starts from the v2 defaults.
- The behavior is not lost — it moved. An agent (or an API client) now passes these two knobs on each `kb__search` call, so result count and threshold are per query rather than fixed per-base settings.
- The hybrid weight slider is unaffected; bases that had it configured keep it.

## What the user should do

Nothing is required to keep searching — bases work with default tuning out of the box. If you relied on a custom per-base result count or relevance threshold, set it per query instead via the `kb__search` tool parameters (`topK`, `threshold`). The hybrid-weight slider stays where it was.

## Notes for release manager

- Tied to the per-call retrieval refactor (local commit `97c5df0082`) and its partial revert: `documentCount` and `threshold` are dropped from the `knowledge_base` schema, entity, runtime config, and the v1 migrator's `transformKnowledgeBase`; `KnowledgeSearchOptions` (`topK` / `threshold`) is added to `KnowledgeService.search`. `hybridAlpha` was kept as per-base config (it is not in `KnowledgeSearchOptions` and not a `kb__search` parameter).
- `threshold` only gates relevance-scored matches (vector mode, or reranked results) — it is a no-op for plain BM25/hybrid ranking scores. The `kb__search` tool's `threshold` description states this.
- REST API surface: `POST /knowledge-bases/search` body field `document_count` was renamed to `top_k` (`schemas.ts`) and is now passed to `KnowledgeService.search` as `{ topK }`; previously it was only applied as a post-hoc `slice`, so any `top_k`/`document_count` above the service default (10) could never be filled on a single-base request.
- Design rationale (why `topK`/`threshold` go per-call while `hybridAlpha` stays per-base config) is recorded in `knowledge-technical-design.md` §6.1.
