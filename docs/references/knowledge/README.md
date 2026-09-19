---
description: Entry point for the current Knowledge backend, ingestion workflow, retrieval, and operation guards
sources:
  - src/main/features/knowledge
  - src/main/data/db/schemas/knowledge.ts
  - src/main/ai/tools/knowledgeLookup.ts
---

# Knowledge Reference

This is the entry point for the current Knowledge domain: SQLite-backed base,
item, and external-source state; Knowledge-owned source files; per-base derived
indexes; durable ingestion jobs; renderer IPC; and agent retrieval tools.

| Document | What it covers |
|---|---|
| [Knowledge Service](./knowledge-service.md) | Current backend shape: service split, IPC, storage, item status, retrieval, and agent tools |
| [Knowledge Operation Guards](./operation-guards.md) | Guard and recovery semantics for `addItems`, `deleteItems`, and `reindexItems` |
| [Knowledge Workflow Architecture](./workflow-architecture.md) | The workflow model: scheduling, durable JobManager jobs, per-base mutation lock, crash semantics |
| [Feishu Connection Remediation Design](./feishu-connection-fix-design.md) | Layer 1 fixes for stable identity, atomic credential replacement, runtime validation, and protocol hardening |
| [Feishu Connection Remediation Implementation](./feishu-connection-fix-implementation.md) | Test-driven tasks, exact files, verification commands, and signed commit boundaries for PR 20699 |
| [External Knowledge Layer 2 Remediation Implementation](./external-knowledge-layer2-remediation-implementation.md) | Test-driven implementation record for connection deletion, ownership guards, external snapshot reading, and preparation/publication boundaries |
| [Knowledge Storage and Retrieval](./experiment/knowledge-technical-design.md) | Current raw-file layout, per-base index schema, retrieval, and migration validation |
