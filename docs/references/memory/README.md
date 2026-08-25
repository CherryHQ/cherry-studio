---
description: Entry point for the memory mechanisms — Agent File Memory, Knowledge Base, and MCP Memory — plus the status of the v1 Global Memory feature
sources:
  - src/main/ai/agents/prompt.ts
  - src/main/ai/agents/tools/memoryTools.ts
  - src/main/ai/mcp/servers/memory.ts
  - src/main/features/knowledge
---

# Memory Reference

Cherry Studio provides three memory mechanisms that differ in who they serve,
how they persist, and where they are stored: file-based memory for Agents
(`SOUL.md` / `USER.md` / `FACT.md` / `JOURNAL.jsonl`), the Knowledge Base, and
the built-in `@cherry/memory` MCP server. The v1 "Global Memory" toggle was
removed in v2 ([#14250](https://github.com/CherryHQ/cherry-studio/issues/14250));
see the overview for what to use instead.

| Document | What it covers |
|---|---|
| [Memory Feature Overview](./overview.md) | Comparison of the mechanisms: scope, persistence, storage, and when to use each; plus the v1 Global Memory removal note |
