---
description: Comparison of the four memory mechanisms in Cherry Studio — Global Memory, Agent File Memory, Knowledge Base, and MCP Memory
sources:
  - src/shared/data/preference/preferenceSchemas.ts
  - src/main/ai/agents/prompt.ts
  - src/main/ai/agents/tools/memoryTools.ts
  - src/main/ai/mcp/servers/memory.ts
  - src/main/features/knowledge
---

# Memory Feature Overview

Cherry Studio provides four distinct memory mechanisms. They differ in who they serve, how they persist, and where they are stored. Use this reference to pick the right one for your use case and to understand why enabling one does not affect the others.

## Comparison

| Memory Type | Applies To | Persistence | Storage Location | Cross-Session | Cross-Agent |
|---|---|---|---|---|---|
| Global Memory | Assistant | Model auto-extracts facts from chat | Cloud / local (preference `feature.memory.enabled`) | Yes | Yes |
| Agent File Memory | Agent | File read/write (`SOUL.md` / `USER.md` / `FACT.md` / `JOURNAL.jsonl`) | Agent data directory (`{agentData}/memory/`) | Yes | No (per-agent) |
| Knowledge Base | Assistant + Agent | Indexed retrieval (ingestion + vector/query) | Knowledge base directory | Yes | Yes |
| MCP Memory | Agent | MCP protocol (`@cherry/memory` built-in server) | MCP server (`memory.json` knowledge graph) | Yes | Depends on server impl |

## Details

### Global Memory (Assistant only)

- Enabled by the **Global Memory** toggle in Settings → General (preference `feature.memory.enabled`).
- When on, the model extracts durable facts from assistant chats automatically; they are recalled in later assistant sessions.
- **Does not apply to Agents.** Agents do not read or write global memory; they use file-based memory instead. The settings toggle shows a hint to this effect so the scope is not mistaken for global.

### Agent File Memory (Agent only)

- Four files under the agent's data directory carry identity and memory across workspaces and sessions:
  - `SOUL.md` — how the agent presents itself (persona / tone)
  - `USER.md` — who the user is (preferences, context)
  - `memory/FACT.md` — durable knowledge and decisions (6+ months)
  - `memory/JOURNAL.jsonl` — append-only event log
- Loaded into the system prompt at session start; updated by the agent autonomously via `mcp__agent-memory__memory` (FACT/JOURNAL) and Read/Edit tools (SOUL/USER).
- Scoped to a single agent. See `src/main/ai/agents/prompt.ts` and `src/main/ai/agents/tools/memoryTools.ts`.

### Knowledge Base (Assistant + Agent)

- User-curated document collections with per-base ingestion and retrieval indexes.
- Both assistants and agents can query the base via the knowledge lookup tools; not automatic — the model must choose to retrieve.
- See `docs/references/knowledge/`.

### MCP Memory (Agent)

- The built-in `@cherry/memory` MCP server (`src/main/ai/mcp/servers/memory.ts`) exposes a `memory.json` knowledge-graph (entities / relations / observations).
- Agents call it through MCP tools; persistence and sharing depend on the server implementation.

## Choosing

- Remembering *about the user* across assistant chats → **Global Memory**.
- Agent persona and long-running project knowledge for a single agent → **Agent File Memory**.
- Searchable reference material you curate → **Knowledge Base**.
- Structured entity/relation memory driven by MCP → **MCP Memory**.
