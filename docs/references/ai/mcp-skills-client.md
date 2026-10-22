---
description: MCP Skills discovery, verified lazy reads, tool approval, and Claude Code/Pi integration
sources:
  - src/main/ai/skills/McpSkillService.ts
  - src/main/ai/skills/mcpSkillContent.ts
  - src/main/ai/mcp/connections/ClientMcpConnection.ts
  - src/main/ai/mcp/servers/skills.ts
  - src/main/data/services/AgentSessionMessageService.ts
  - src/renderer/hooks/useMcpSkills.ts
  - src/renderer/components/composer/variants/AgentComposer.tsx
  - src/shared/types/mcpSkills.ts
---

# MCP Skills Client

English | [中文](mcp-skills-client.zh.md)

Cherry consumes the [MCP Skills extension](https://skills.extensions.modelcontextprotocol.io/specification/stable/skills) in Claude Code and Pi Agent sessions. The server must advertise `io.modelcontextprotocol/skills` and resources on the modern protocol. Legacy and non-advertising servers retain their existing behavior. Dynamic skill manifests are currently unsupported; ordinary Assistant chat and serving Cherry skills to external MCP clients are outside this feature.

## User flow

1. Select an active MCP server for the Agent, then open **Skills** in the conversation composer. Remote entries show their server label and URI alongside local skills.
2. Selecting an entry inserts a usage request into the composer. It does not install or load files.
3. The model calls `load_mcp_skill`. Its ordinary tool approval follows the session permission mode; Full Access can skip this loading prompt. There is no separate consent dialog or execution checkbox.
4. Loading returns metadata, the complete file manifest, and verified `SKILL.md` together. Supporting files are read only on demand. Declining the load tool fetches no skill files.

Names are display labels. The stable identity is `(serverId, skillUri)`, including when several servers expose the same URI or one server exposes the same name at multiple paths. The initial prompt need not contain skill names or descriptions. The model uses `list_mcp_skills` to discover them, or calls `load_mcp_skill` with a known server ID and URI; a partial catalog does not prevent direct URI lookup.

## Ownership

| Owner | Contract |
|---|---|
| `ClientMcpConnection` | Capability-gated, paginated `skills/list` and direct `skills/get` through the SDK's public extension request API. |
| `McpRuntimeService` / `McpCatalogService` | Existing connection, timeout, cancellation, current server configuration, and metadata projection. Metadata is fetched afresh. |
| `McpSkillService` | Session-held manifests, provenance, integrity checks, memory-only content cache, origin enforcement, and tool guards. |
| `AgentSessionRuntimeService` | Open/close the skill session, persist load provenance before returning content, and present tool approvals through the existing Tool Approval registry. |
| Composer / IpcApi | Metadata-only discovery while the picker is open, cancellation on close, and explicit error rows for failed origins. |

The host exposes `list_mcp_skills`, `load_mcp_skill`, and `read_mcp_skill_file`. Both runtimes use the same service. Pi exposes the builtin skills server directly so reading supporting files does not require executing a code-mode script. The load result contains the complete manifest, including paths of supporting files; there is no additional directory tool. No remote directories enter the local skill library or native skill discovery.

## Integrity and permissions

Manifest admission validates names, roots, resource containment and uniqueness, a maximum of 512 files including `SKILL.md`, and a total of 16 MiB. Every fetched file must match the held manifest's byte size and SHA-256. Entry-file YAML must match all advertised frontmatter fields, including unknown fields. Content is read through the originating MCP connection, never by dereferencing a remote URI through HTTP or the filesystem.

Loaded instructions remain untrusted tool-result context. Frontmatter cannot install hooks or grant tool permissions. Loading grants no execution permission. Host execution tools, including Bash, automation, code mode, and local skill activation, require per-call approval while remote skills are active in ordinary permission modes. Full Access automatically allows skill loading, execution, nested activation, and cross-origin reads without approval or rejection prompts. Integrity and origin checks still apply. This intentionally relaxes the MCP Skills specification’s explicit-approval requirement in Full Access. The standard approval card shows the tool and its input without an additional skill explanation. Approval does not carry over to the next call. Ordinary read/search and remote tools retain their normal policies; all other tool restrictions still apply.

A supporting nested `SKILL.md` is ordinary Markdown. Activating that nested skill requires its own load and, outside Full Access, explicit tool approval. Generic resource reads in a session with loaded skills pass the same held-manifest checks. Outside Full Access, reading from another server requires explicit tool approval naming both origins for that individual read, including when both servers have loaded skills.

## Invalidation and recovery

The host conservatively holds each loaded manifest for the whole session. Changed manifests or file integrity failures invalidate the held entry; a new session is required to load a replacement without mixing instructions. Server removal, disablement, connection/authentication changes, deselection, cancellation, and session close reject stale operations and approvals. The first load approval is bound to the target configuration before any instructions are loaded; changing that configuration cancels the pending approval and requires a fresh decision. A successful decision carries a single-use host receipt through the runtime’s updated tool input to the builtin load handler. The receipt binds the session, server, URI, original configuration and cancellation signal through completion; another approval cannot revive an older call. The receipt is consumed before execution, its validation record remains memory-only, and Full Access needs no receipt. Cancelled host resource approvals are settled in persisted message history and published before the waiting read resumes, so their cards are no longer actionable.

Before exposing loaded instructions to the runtime, the host stores their origin, manifest, and a SHA-256 fingerprint of the original connection/authentication configuration in private message `data.mcpSkills`. Raw configuration secrets are not stored there. Invalidation is persisted with every retained copy of that skill. Restoring or forking preserves these facts and rejects a changed origin, even if it changed while the session was closed. Reopening a session or restarting the service cannot clear invalidation, including in Full Access. Public reads omit this metadata; public writes cannot forge or erase it. Deleting an individual provenance-bearing message is refused because native history can still retain its instructions; deleting the session removes its history. Normal persistence and native forks retain it. This changes the existing JSON payload type, not the SQLite schema, and stores neither reusable approvals nor remote file content. Restored and forked sessions retain the execution gate without prompting merely to resume. Operations requiring approval fail closed without an interactive responder.

## Verification

The shared fixture in `tests/helpers/mcpSkills.ts` supports real SDK wire tests and database-backed host tests. They cover pagination, legacy compatibility, lazy reads, integrity limits, origin collisions, nested activation, both runtime guards, restoration, and cancellation. The reviewed on-demand scenario `tests/e2e/ondemand/specs/mcp-skills.ts` uses a loopback MCP peer and scripted Anthropic responses to exercise both runtimes through Electron, including the picker, loading approval, supporting-file result, execution approval and rejection in ordinary mode, cancellation of an initial load approval after server reconfiguration, and prompt-free loading and execution in Full Access. Scripted local acceptance is distinct from remote CI or live-provider acceptance.
