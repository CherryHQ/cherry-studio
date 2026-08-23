---
description: Entry point for the current Knowledge backend, ingestion workflow, retrieval, and operation guards
sources:
  - src/main/features/knowledge
  - src/main/data/db/schemas/knowledge.ts
  - src/main/ai/tools/knowledgeLookup.ts
---

# Knowledge Reference

This is the entry point for the current Knowledge domain: SQLite-backed base
and item state, Knowledge-owned source files, per-base derived indexes, durable
ingestion jobs, renderer IPC, and agent retrieval tools.

| Document | What it covers |
|---|---|
| [Knowledge Service](./knowledge-service.md) | Current backend shape: service split, IPC, storage, item status, retrieval, and agent tools |
| [Knowledge Operation Guards](./operation-guards.md) | Guard and recovery semantics for `addItems`, `deleteItems`, and `reindexItems` |
| [Knowledge Workflow Architecture](./workflow-architecture.md) | The workflow model: scheduling, durable JobManager jobs, per-base mutation lock, crash semantics |
| [Knowledge Storage and Retrieval](./experiment/knowledge-technical-design.md) | Current raw-file layout, per-base index schema, retrieval, and migration validation |
