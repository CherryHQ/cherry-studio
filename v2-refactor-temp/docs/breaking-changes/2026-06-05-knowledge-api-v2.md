---
title: Knowledge API responses now use v2 knowledge data
category: changed
severity: breaking
introduced_in_pr: TBD
date: 2026-06-05
---

## What changed

The local API server knowledge endpoints now read from the v2 SQLite-backed knowledge system. `GET /v1/knowledge-bases`, `GET /v1/knowledge-bases/{id}`, and `POST /v1/knowledge-bases/search` return v2-native knowledge base and search result fields instead of the legacy Redux/embedjs response shape.

The response **envelope is unchanged**: `GET /v1/knowledge-bases` still returns `{ knowledge_bases, total }`, and `POST /v1/knowledge-bases/search` still returns `{ query, results, total, searched_bases }`. What changed is the shape of each **entry** inside those arrays.

## Why this matters to the user

Users or integrations that call the local API server may need to update response parsing. The wrapper field names (`knowledge_bases`, `searched_bases`, `total`) are the same as before, but each entry now exposes v2-native fields instead of the legacy knowledge base model/search result shape.

## What the user should do

Update API clients to read the v2 per-entry fields:

- Each knowledge base entry (in `knowledge_bases`, and the `GET /:id` body) now carries v2 fields such as `embeddingModelId` and `createdAt`.
- Each search result entry (in `results`) now carries `chunkId`, `score`, `scoreKind`, and `rank`, plus the gateway-added `knowledge_base_id` and `knowledge_base_name`.

There is no `page` field, and `searched_bases` keeps its snake_case name (it is not renamed to `searchedBases`).

## Notes for release manager

This entry is tied to removal of the legacy main-process `src/main/knowledge` runtime.
