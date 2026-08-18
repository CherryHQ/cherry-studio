---
description: Entry point for knowledge domain references covering the v2 backend, workflow, operation guards, and experiment specs
sources:
  - src/main/features/knowledge
  - src/main/data/db/schemas/knowledge.ts
---

# Knowledge Reference

This is the entry point for the knowledge domain in Cherry Studio v2 — the main-process
knowledge backend under `src/main/features/knowledge`: SQLite-backed base/item data,
the durable ingestion workflow, retrieval, and the product/technical experiment specs.

| Document | What it covers |
|---|---|
| [Knowledge Service](./knowledge-service.md) | Current v2 backend shape: service split, IPC surface, item statuses, delete/reindex/restore flows, and search |
| [Knowledge Operation Guards](./operation-guards.md) | Guard and recovery semantics for `addItems`, `deleteItems`, and `reindexItems` |
| [Knowledge Workflow Architecture](./workflow-architecture.md) | The workflow model: scheduling, durable JobManager jobs, per-base mutation lock, crash semantics |
| [Knowledge Product Spec](./experiment/knowledge-product-spec.md) | Product positioning, principles, material behavior rules, and settled product decisions |
| [Knowledge Technical Design](./experiment/knowledge-technical-design.md) | Folder-backed storage design: `raw/` layout, per-base `index.sqlite` schema, OKF snapshots, decision record |
