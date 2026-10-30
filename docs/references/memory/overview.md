---
description: Shared and private managed file memory, legacy migration, Knowledge Base, and independent graph memory
sources:
  - src/main/ai/agents/prompt.ts
  - src/main/ai/memory
  - src/main/ai/mcp/servers/memory.ts
  - src/main/features/knowledge
---

# Memory Feature Overview

Cherry Studio provides three distinct memory mechanisms. They differ in who they serve, how they persist, and where they are stored. Use this reference to pick the right one for your use case and to understand why enabling one does not affect the others.

## Comparison

| Memory Type | Applies To | Persistence | Storage Location | Cross-Session | Cross-Agent |
|---|---|---|---|---|---|
| Managed File Memory | Agent + opted-in persistent Assistant | Controlled Markdown read/write (`MEMORY.md` / `.memories/*.md`) | Shared `{userData}/Data/Memory/`; private `{agentData}/` | Yes | Shared preferences only; private knowledge stays with its Agent |
| Knowledge Base | Assistant + Agent | Indexed retrieval (ingestion + vector/query) | Knowledge base directory | Yes | Yes |
| MCP Memory | Agent | MCP protocol (`@cherry/memory` built-in server) | MCP server (`memory.json` knowledge graph) | Yes | Depends on server impl |

## About "Global Memory"

Cherry Studio v1.x had **Global Memory**: a Settings toggle (`feature.memory.enabled`) that extracted durable facts from assistant chats. It was removed in v2 ([#14250](https://github.com/CherryHQ/cherry-studio/issues/14250)). Managed shared memory is a separate feature. Enabling access does not authorize reading or extracting all chat history.

If you relied on Global Memory in v1:

- Agents can use shared preferences and their own private knowledge. Shared access defaults on for desktop Agents; external channels cannot access shared memory.
- Persistent Assistants can opt in to shared entry references. Temporary and auxiliary requests remain ineligible. Assistant and Claude Code memory editing requires a supported execution adapter.

## Details

### Managed File Memory

- `MEMORY.md` contains complete common facts and selected topic links. `.memories/*.md` contains related details. Each request reloads only eligible entries; topics require a full controlled read before editing.
- Settings → Shared Memory lists managed filenames without fetching or previewing their contents. It exposes confirmed topic deletion, global/shared clearing, and recovery. Agent private-memory entry points are removed. File feedback comes only from actual commit results, not index state or item counts; recoverable backups remain after clearing.
- Entries allow 200 lines and 25,000 UTF-8 bytes; topics allow 25,000 bytes. Oversized external originals are preserved. These limits are save protections, not additional configuration fields.
- Pi native reads, writes, and edits bind caller-specific read receipts to exact approved proposals. Backups precede writes, and actual results are checked. Unsupported Claude native operations and identity-free filesystem MCP access to managed memory are rejected. Shell and external tools remain outside this cooperative protection.
- Each scope retains up to five recovery batches within 20 MiB. Protected batches are retained; insufficient backup capacity rejects a write. Recovery protects later changes and reports conflicts or partial results.
- `SOUL.md` and `USER.md` remain separate identity files. Their contents are not copied into shared memory.

Legacy FACT migration preserves complete Markdown sections and original bytes, then checks every new private file before activation. Oversized indivisible sections or conflicts leave migration incomplete and retain readonly legacy facts. JOURNAL is unchanged and stops receiving events. Neither the old Agent Memory MCP nor ordinary file tools write these historical files. No dual-writing or alternating old/new app version compatibility is promised.

### Organization (Dreaming)

The global "Generate memory in chats" switch defaults on and controls Dreaming through the existing preference configuration. "Automatically organize memory" is its subordinate switch and also defaults on. Turning off the parent prevents automatic and manual tasks and invalidates pending output. Turning off only the child still allows manual organization. The switches control existing-file organization, not chat-history extraction. The application default model is used; no separate model selector is added.

Settings show the last recorded completed, failed, or cancelled result and its time. This record is separate from the current task state, so disabling a switch or becoming idle cannot report a failed attempt as successful.

One global queue runs only while conversations are idle. A batch includes at most ten complete memory files and 50,000 UTF-8 bytes, then reduces inputs further to fit the model's declared limits. It makes one model call with tools disabled. Unknown or insufficient model capacity pauses work. No chat history, JOURNAL, identity files, other scopes, or network retrieval is supplied.

Eligible changes are ten controlled content edits to a file, seven days since its first pending change, changed/unprocessed content reaching the size warning, or a manual request. Metadata, failed/no-op saves, organization, and recovery do not add controlled counts. External changes start a pending observation without inventing edit counts. Unchanged checked files do not trigger again merely because they are large.

Durable progress lives in module-owned `app_state`; JobManager history can be removed independently. Each unchanged input is included in the commit baseline. Failures allow at most two attempts per unchanged input with a ten-minute delay; a manual request or new input creates another opportunity. Cancellation, shutdown, clearing, recovery, and deleted owners fence uncommitted output. A foreground conversation interrupts active organization.

Topic deletion is conservative: all active files must have been supplied, source text must remain verbatim in a written topic destination, and remaining Markdown/wiki links must no longer target the source. HTML links require manual review. Destinations and link edits save before removal. Partial saves remain recoverable. This does not prove semantic equivalence of model rewrites.

The implementation remains a Draft stack. Focused lifecycle, migration, file-commit, settings, and cancellation regressions are covered. Native-platform, representative-model, and packaged-build acceptance remain incomplete. See [the module contract](../../../src/main/ai/memory/README.md) for boundaries.

### Knowledge Base (Assistant + Agent)

- User-curated document collections with per-base ingestion and retrieval indexes.
- Both assistants and agents can query the base via the knowledge lookup tools; not automatic — the model must choose to retrieve.
- See `docs/references/knowledge/`.

### MCP Memory (Agent)

- The built-in `@cherry/memory` MCP server (`src/main/ai/mcp/servers/memory.ts`) exposes a `memory.json` knowledge-graph (entities / relations / observations).
- Agents call it through MCP tools; persistence and sharing depend on the server implementation.

## Choosing

- Common preferences across eligible callers → **Shared File Memory**.
- Long-running project knowledge for a single Agent → **Private File Memory**; persona remains in SOUL.md/USER.md.
- Searchable reference material you curate → **Knowledge Base**.
- Structured entity/relation memory driven by MCP → **MCP Memory**.
