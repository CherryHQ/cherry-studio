---
description: Comparison of the three memory mechanisms in Cherry Studio — Agent File Memory, Knowledge Base, and MCP Memory — plus the status of the v1 Global Memory feature
sources:
  - src/main/ai/agents/prompt.ts
  - src/main/ai/agents/tools/memoryTools.ts
  - src/main/ai/mcp/servers/memory.ts
  - src/main/features/knowledge
---

# Memory Feature Overview

Cherry Studio provides three distinct memory mechanisms. They differ in who they serve, how they persist, and where they are stored. Use this reference to pick the right one for your use case and to understand why enabling one does not affect the others.

## Comparison

| Memory Type | Applies To | Persistence | Storage Location | Cross-Session | Cross-Agent |
|---|---|---|---|---|---|
| Agent File Memory | Agent | File read/write (`SOUL.md` / `USER.md` / `FACT.md` / `JOURNAL.jsonl`) | Agent data directory (`{agentData}/memory/`) | Yes | No (per-agent) |
| Knowledge Base | Assistant + Agent | Indexed retrieval (ingestion + vector/query) | Knowledge base directory | Yes | Yes |
| MCP Memory | Agent | MCP protocol (`@cherry/memory` built-in server) | MCP server (`memory.json` knowledge graph) | Yes | Depends on server impl |

## About "Global Memory"

Cherry Studio v1.x had a fourth mechanism, **Global Memory**: a Settings toggle (`feature.memory.enabled`) that made the model auto-extract durable facts from assistant chats and recall them in later assistant sessions. It was **removed in v2** ([#14250](https://github.com/CherryHQ/cherry-studio/issues/14250)) because its setup was complex and its quality did not justify the overhead. There is deliberately no Global Memory toggle in v2 settings and no replacement yet.

If you relied on Global Memory in v1:

- For Agents, use **Agent File Memory** — it serves the same remember-about-the-user role via `USER.md`, scoped per agent.
- For Assistants, put durable facts into the assistant's prompt, or curate them in a **Knowledge Base** until a successor feature lands.

## Details

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

- Agent persona and long-running project knowledge for a single agent → **Agent File Memory**.
- Searchable reference material you curate → **Knowledge Base**.
- Structured entity/relation memory driven by MCP → **MCP Memory**.
