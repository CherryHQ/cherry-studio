---
description: Entry point for managed shared/private memory, legacy migration, Knowledge Base, and graph memory
sources:
  - src/main/ai/agents/prompt.ts
  - src/main/ai/memory
  - src/main/ai/mcp/servers/memory.ts
  - src/main/features/knowledge
---

# Memory Reference

Managed memory stores shared personal context and Agent-private knowledge in
`MEMORY.md` and `.memories/`. Conversation extraction writes eligible new facts;
Dreaming organizes existing files. The `memory_search` tool retrieves historical
conversations for the current answer. Knowledge Base and `@cherry/memory`
graph MCP remain independent capabilities.

`SOUL.md` and `USER.md` keep their identity roles. Legacy FACT is migrated
privately; JOURNAL remains unchanged history. The Agent's existing Memory tab
shows identity and legacy files.

| Document | What it covers |
|---|---|
| [Memory Feature Overview](./overview.md) | Settings, access, conversation snapshots, extraction, recall, organization, recovery, and current limitations |
