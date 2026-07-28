---
title: Knowledge search index rebuilt on a new storage layout — old indexes need reindexing
category: data-migration
severity: breaking
introduced_in_pr: "#15973"
date: 2026-06-11
---

## What changed

Knowledge base retrieval now runs on a new per-base index layout inside `index.sqlite`. Indexes written by earlier v2 dev builds (the removed vendored vector store) and, until PR B lands, the output of the v1 → v2 knowledge vector migration use the old single-table layout, which the new runtime does not read.

## Why this matters to the user

A base whose `index.sqlite` still holds the old layout opens normally and shows its items as completed, but search and chunk listing return empty results. The app logs an error at store open ("legacy single-table vector layout…") identifying the affected base.

## What the user should do

Reindex the affected knowledge base (reindex its items, or recreate the base). Embeddings are recomputed, so the embedding provider is called again.

## Notes for release manager

- **PR B is a hard blocker for v2 GA / for shipping the v1 knowledge migration to real users**: it rewrites `KnowledgeVectorMigrator` to emit the new layout (and/or rewrites legacy files on open) so migrated users do not land in the silent-empty state. If PR B lands before release, this entry collapses to a dev-build-only notice.
- The transitional contract is pinned by an integration test in `src/main/data/migration/v2/migrators/__tests__/KnowledgeVectorMigrator.test.ts` that must be rewritten with PR B.
