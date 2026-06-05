---
title: Knowledge API responses now use v2 knowledge data
category: changed
severity: breaking
introduced_in_pr: TBD
date: 2026-06-05
---

## What changed

The local API server knowledge endpoints now read from the v2 SQLite-backed knowledge system. `GET /v1/knowledge-bases`, `GET /v1/knowledge-bases/{id}`, and `POST /v1/knowledge-bases/search` return v2-native knowledge base and search result fields instead of the legacy Redux/embedjs response shape.

## Why this matters to the user

Users or integrations that call the local API server may need to update response parsing. Legacy fields such as `knowledge_bases`, `searched_bases`, and old knowledge base model/item objects are no longer returned by these endpoints.

## What the user should do

Update API clients to read v2 fields such as `items`, `page`, `embeddingModelId`, `createdAt`, `searchedBases`, `scoreKind`, `rank`, and `chunkId`.

## Notes for release manager

This entry is tied to removal of the legacy main-process `src/main/knowledge` runtime.
