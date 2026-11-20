---
description: MCP Skills discovery, verified lazy reads, tool approval, and Claude Code/Pi integration
sources:
  - src/main/ai/skills/McpSkillService.ts
  - src/main/ai/skills/mcpSkillContent.ts
  - src/main/ai/mcp/connections/ClientMcpConnection.ts
  - src/main/ai/mcp/servers/skills.ts
  - src/main/ai/toolApproval/mcpSkillApproval.ts
  - src/main/ai/toolApproval/ToolApprovalRegistry.ts
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
| `ClientMcpConnection` | SDK `SkillsClient` capability detection and direct lookup, with official core schemas and host pagination that rejects repeated cursors and duplicate URIs. |
| `McpRuntimeService` / `McpCatalogService` | Existing connection, timeout, cancellation, current server configuration, and metadata projection. Metadata is fetched afresh. |
| `McpSkillService` | Session-held manifests, verified memory-only content, and snapshots of origin and cancellation state. |
| Tool Approval | Execution classification, cross-origin approval, and single-use approved invocations bound by `ToolApprovalRegistry` to the session, tool, arguments and captured state. |
| `AgentSessionRuntimeService` | Open/close the in-memory skill session and present tool approvals through the existing Tool Approval registry. |
| Composer / IpcApi | Metadata-only discovery while the picker is open, cancellation on close, and explicit error rows for failed origins. |

The host exposes `list_mcp_skills`, `load_mcp_skill`, and `read_mcp_skill_file`. Both runtimes use the same service. Pi exposes the builtin skills server directly so reading supporting files does not require executing a code-mode script. The load result contains the complete manifest, including paths of supporting files; there is no additional directory tool. No remote directories enter the local skill library or native skill discovery.

Skill state does not classify tools or decide permission modes. The approval layer consumes its snapshots, and the MCP resource boundary applies approval and content verification to both fetched and cached reads. One origin state per server cancels affected work when configuration changes; each read needs no separate configuration listener. Each resource response is verified once against every matching held manifest.

## Integrity and permissions

Manifest admission validates names, roots, resource containment and uniqueness, a maximum of 512 files including `SKILL.md`, and a total of 16 MiB. Every fetched file must match the held manifest's byte size and SHA-256. Entry-file YAML must match all advertised frontmatter fields, including unknown fields. Content is read through the originating MCP connection, never by dereferencing a remote URI through HTTP or the filesystem.

Loaded instructions remain untrusted tool-result context. Frontmatter cannot install hooks or grant tool permissions. Loading grants no execution permission. Host execution tools, including Bash, automation, code mode, local skill activation, and cross-session delegation through `session_create` / `session_send`, require per-call approval while remote skills are active in ordinary permission modes. Full Access automatically allows skill loading, execution, nested activation, and cross-origin reads without approval or rejection prompts. Integrity and origin checks still apply. This intentionally relaxes the MCP Skills specification’s explicit-approval requirement in Full Access. The standard approval card shows the tool and its input without an additional skill explanation. Approval does not carry over to the next call. Scheduled execution through cron `add` / `update` follows the same per-call approval boundary outside Full Access, including updates that only change the schedule; cron `list` / `remove` retain their normal policies. Ordinary read/search and remote tools retain their normal policies; all other tool restrictions still apply.

A supporting nested `SKILL.md` is ordinary Markdown. Activating that nested skill requires its own load and, outside Full Access, explicit tool approval. Generic resource reads in a session with loaded skills pass the same held-manifest checks. Outside Full Access, reading from another server requires explicit tool approval naming both origins for that individual read, including when both servers have loaded skills.

## Invalidation and recovery

The host holds each loaded manifest in the current runtime session’s memory. Changed manifests or file integrity failures discard the entry and cancel its pending operations and approvals. The skill can be loaded again in the same session; the fresh load verifies the current manifest and content. Server removal, disablement, connection/authentication changes, deselection, cancellation, and session close reject stale operations and approvals. The first load approval is bound to the target configuration before any instructions are loaded; changing that configuration cancels the pending approval and requires a fresh decision. A successful decision carries a single-use host receipt through the runtime’s updated tool input to the builtin load handler. The receipt binds the session, server, URI, original configuration and cancellation signal through completion; another approval cannot revive an older call. The receipt is consumed before execution, its validation record remains memory-only, and Full Access needs no receipt. Cancelled host resource approvals are settled in persisted message history and published before the waiting read resumes, so their cards are no longer actionable.

Closing or forking a runtime does not restore skill activation. Supporting-file reads require a fresh load, and ordinary tool policy applies until then. Skill state is not written to message metadata, and discovery does not scan retained message history. Historical tool results remain ordinary conversation history; reloading does not remove earlier skill text from the model context. This scope does not retain the extension’s acting-window state across runtime close or replacement. Operations requiring approval fail closed without an interactive responder.

## Verification

The shared fixture in `tests/helpers/mcpSkills.ts` supports real SDK wire tests and database-backed host tests. They cover pagination, legacy compatibility, lazy reads, integrity limits, origin collisions, nested activation, both runtime guards, same-session reloading, activation reset on reopen, and cancellation. The reviewed on-demand scenario `tests/e2e/ondemand/specs/mcp-skills.ts` uses a loopback MCP peer and scripted Anthropic responses to exercise both runtimes through Electron, including the picker, loading approval, supporting-file result, execution approval and rejection in ordinary mode, cancellation of an initial load approval after server reconfiguration, and prompt-free loading and execution in Full Access. Scripted local acceptance is distinct from remote CI or live-provider acceptance.
