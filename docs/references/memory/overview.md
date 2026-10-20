---
description: Comparison of the three memory mechanisms in Cherry Studio — Agent File Memory, Knowledge Base, and MCP Memory — plus the status of the v1 Global Memory feature
sources:
  - src/main/ai/assistantMemory.ts
  - src/main/ai/tools/adapters/aiSdk/builtin/UserMemoryTool.ts
  - src/main/ai/agents/userMemory.ts
  - src/main/ai/agents/memoryFiles.ts
  - src/main/ai/agents/memoryFactsView.ts
  - src/renderer/pages/settings/UserMemorySettings.tsx
  - src/main/ai/agents/prompt.ts
  - src/main/ai/mcp/servers/agentMemory.ts
  - src/main/ai/mcp/servers/memory.ts
  - src/main/features/knowledge
---

# Memory Feature Overview

Cherry Studio provides three distinct memory mechanisms. They differ in who they serve, how they persist, and where they are stored. Use this reference to pick the right one for your use case and to understand why enabling one does not affect the others.

## Comparison

| Memory Type | Applies To | Persistence | Storage Location | Cross-Session | Cross-Agent |
|---|---|---|---|---|---|
| File Memory | Agent; opted-in Assistant (shared tier only) | File read/write (`SOUL.md` / `USER.md` / `FACT.md` / `JOURNAL.jsonl`) | Agent data directory (`{agentData}/memory/`) | Yes | Agent-local files: no; user-level tier: yes |
| Knowledge Base | Assistant + Agent | Indexed retrieval (ingestion + vector/query) | Knowledge base directory | Yes | Yes |
| MCP Memory | Agent | MCP protocol (`@cherry/memory` built-in server) | MCP server (`memory.json` knowledge graph) | Yes | Depends on server impl |

## About "Global Memory"

Cherry Studio v1.x had a fourth mechanism, **Global Memory**: a Settings toggle (`feature.memory.enabled`) that made the model auto-extract durable facts from assistant chats and recall them in later assistant sessions. It was **removed in v2** ([#14250](https://github.com/CherryHQ/cherry-studio/issues/14250)) because its setup was complex and its quality did not justify the overhead. That assistant-chat extraction pipeline remains removed. Desktop Agents and opted-in Assistants now use a separate file-based user-level tier described below; it requires no embedding model or database memory table.

If you relied on Global Memory in v1:

- For Agents, use **Agent File Memory** — it serves the same remember-about-the-user role via `USER.md`, scoped per agent.
- For Assistants, the shared file tier is available through an explicit settings opt-in (runtime support; UI control pending). Assistant prompts and **Knowledge Base** remain separate context sources.

## Details

### Agent File Memory (Agent only)

- Four files under the agent's data directory carry identity and memory across workspaces and sessions:
  - `SOUL.md` — how the agent presents itself (persona / tone)
  - `USER.md` — who the user is (preferences, context)
  - `memory/FACT.md` — durable knowledge and decisions (6+ months)
  - `memory/JOURNAL.jsonl` — append-only event log
- Loaded into the system prompt at session start; updated by the agent autonomously via `mcp__agent-memory__memory` (FACT/JOURNAL) and Read/Edit tools (SOUL/USER).
- Scoped to a single agent. See `src/main/ai/agents/prompt.ts` and `src/main/ai/mcp/servers/agentMemory.ts`.

### Shared user memory (desktop only)

- `application.getPath('user.memory')` resolves to `{userData}/Data/Memory`. `USER_FACT.md` stores current durable user facts; `USER_JOURNAL.jsonl` contains timestamped `{ ts, tags, text }` events. Initialization creates missing empty files without promoting or changing existing Agent files.
- The same memory tool accepts `scope: 'agent' | 'user'`, defaulting to `agent`. `read` returns `{ content, revision }`. User-level `update` requires `expectedRevision`; a stale revision fails with `MEMORY_CONFLICT`. Re-read and reconcile before retrying. An empty content string clears user facts. Agent-scope calls retain their previous behavior.
- Application writes share a main-process keyed mutex and atomic file replacement. Electron's profile-scoped single-instance lock keeps one application writer process. Arbitrary external editors do not participate in this protocol.
- Both runtimes refresh separate `User-Level Facts` and `Agent Workspace Facts` sections at turn boundaries, including session recovery, compaction, and local heartbeats. Conflicting facts are retained with an instruction to identify both sources; neither tier is silently merged. Memory remains context rather than behavioral authority. Journals are only searched on demand.
- `configuration.userMemoryEnabled` defaults to true. Turning it off withdraws shared recall on the next turn and rejects shared tool access. Channel-linked sessions cannot read or write this tier regardless of the switch. Existing Agent-local memory remains available.
- Settings → Shared memory loads and displays Markdown and the journal only after the user clicks Load memory. The journal contains explicitly appended timestamped events, not full chat history or an automatic audit of fact edits. Saving uses the same revision check as the tool. Concurrent changes preserve the draft and require explicit reconciliation. Clearing facts leaves historical journal entries and past conversations intact.
- Shared files are included in full data backups and data-directory moves. Database-only slim backups omit them, just as they omit Agent-local files. No schema migration is needed.

### Knowledge Base (Assistant + Agent)

- User-curated document collections with per-base ingestion and retrieval indexes.
- Both assistants and agents can query the base via the knowledge lookup tools; not automatic — the model must choose to retrieve.
- See `docs/references/knowledge/`.

### MCP Memory (Agent)

- The built-in `@cherry/memory` MCP server (`src/main/ai/mcp/servers/memory.ts`) exposes a `memory.json` knowledge-graph (entities / relations / observations).
- Agents call it through MCP tools; persistence and sharing depend on the server implementation.

### Ordinary Assistant access

Ordinary Assistants opt in with `settings.userMemoryEnabled: true` in their existing settings JSON; omitted or false keeps memory disabled. This runtime layer does not yet add a form control. The shared files and Settings page are the same ones used by Agents; no Assistant-local `USER.md` or Agent workspace memory is exposed.

Only non-headless persistent desktop chat dispatch grants access. Temporary chats, channel/Agent dispatch, and auxiliary requests do not receive that grant. The main process validates the topic/Assistant association and the live setting before loading facts, and again whenever a memory operation resolves its directory. Reassigning or deleting the topic, deleting the Assistant, or disabling the setting rejects subsequent operations.

Each eligible request adds a fresh `User-Level Facts` section without persisting that section as a chat message. The built-in `user_memory` tool supports read, revision-checked update, append, and journal search. Updates and appends require the existing tool approval flow; reads and searches do not. Models without function calling, and requests with tools disabled, can receive facts but cannot write through the tool. Clearing facts withdraws future snapshots, not content already present in historical conversations or an in-flight request. No filesystem MCP configuration is required.

## Choosing

- Agent persona and long-running project knowledge for a single agent → **Agent File Memory**.
- Searchable reference material you curate → **Knowledge Base**.
- Structured entity/relation memory driven by MCP → **MCP Memory**.

## Bounded fact recall

Each injected fact tier is limited to 200 lines or 25,000 UTF-8 bytes, whichever comes first. This is a preview, not a complete index or evidence that omitted facts were deleted. Full files and settings-editor reads remain intact. Tools return bounded pages with UTF-16 `offset` / `nextOffset`; continuation requires the first page's full-file `expectedRevision` and fails on concurrent changes.

For an existing file larger than the preview budget, tool `update` refuses whole-file replacement. Use `patch` with a unique exact `oldText`, `newText`, and `expectedRevision`; unmentioned content is preserved and the existing revision check protects the final atomic write. The settings editor can still save or clear the complete file. Both tool reads and injected previews expose file modification time where available. This timestamp describes the file write, not when each fact was stated or confirmed; old entries are not restamped.
