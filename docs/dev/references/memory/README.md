---
description: Entry point for managed shared/private memory, legacy migration, Knowledge Base, and graph memory
sources:
  - src/main/ai/agents/prompt.ts
  - src/main/ai/memory
  - src/main/ai/mcp/servers/memory.ts
  - src/main/features/knowledge
---

# Memory Reference

Cherry Studio provides three memory mechanisms that differ in who they serve,
how they persist, and where they are stored: managed shared/private Markdown
memory (`MEMORY.md` / `.memories/`), the Knowledge Base, and the built-in
`@cherry/memory` graph MCP server. SOUL.md and USER.md keep their identity roles.
Legacy FACT is migrated privately; JOURNAL remains unchanged history.

| Document | What it covers |
|---|---|
| [Memory Feature Overview](./overview.md) | Comparison of the mechanisms: scope, persistence, storage, and when to use each; plus the v1 Global Memory removal note |
