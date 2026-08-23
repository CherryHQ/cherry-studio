---
description: Entry point for the four memory mechanisms — Global Memory, Agent File Memory, Knowledge Base, and MCP Memory
sources:
  - src/shared/data/preference/preferenceSchemas.ts
  - src/main/ai/agents/prompt.ts
  - src/main/ai/agents/tools/memoryTools.ts
  - src/main/ai/mcp/servers/memory.ts
  - src/main/features/knowledge
---

# Memory Reference

Cherry Studio provides four memory mechanisms that differ in who they serve,
how they persist, and where they are stored: Global Memory for Assistants
(preference `feature.memory.enabled`), file-based memory for Agents
(`SOUL.md` / `USER.md` / `FACT.md` / `JOURNAL.jsonl`), the Knowledge Base, and
the built-in `@cherry/memory` MCP server.

| Document | What it covers |
|---|---|
| [Memory Feature Overview](./overview.md) | Comparison of the four mechanisms: scope, persistence, storage, and when to use each |
