---
description: On-demand MCP Skills discovery, verified file reads, and ordinary tool approval in Agent sessions
sources:
  - src/main/ai/skills/mcpSkillContent.ts
  - src/main/ai/mcp/connections/ClientMcpConnection.ts
  - src/main/ai/mcp/servers/skills.ts
  - src/renderer/hooks/useMcpSkills.ts
  - src/renderer/components/composer/variants/AgentComposer.tsx
  - src/shared/types/mcpSkills.ts
---

# MCP Skills Client

English | [中文](mcp-skills-client.zh.md)

Cherry discovers and reads [MCP Skills](https://skills.extensions.modelcontextprotocol.io/specification/stable/skills) through tools in Claude Code and Pi Agent sessions. Servers must advertise `io.modelcontextprotocol/skills` and resources on the modern protocol. Legacy and non-advertising servers keep their existing behavior. Dynamic manifests, ordinary Assistant chat and serving local skills to external clients are outside scope.

## User flow

1. Select an active MCP server for the Agent and open **Skills** in the composer. Remote entries display their server and URI alongside local skills.
2. Selecting an entry inserts a usage request without installing or fetching files.
3. The model calls `load_mcp_skill` with the server ID and skill URI. Loading uses the normal required-tool approval policy; Full Access skips that prompt. Declining the tool fetches no files.
4. Loading returns the current metadata, complete manifest and verified `SKILL.md`. Supporting files are fetched only when requested with `read_mcp_skill_file`.

The model can discover names and descriptions with `list_mcp_skills`; they need not appear in the initial prompt. A known URI can be loaded without discovery. Identity is `(serverId, skillUri)`, so matching names or URIs on different origins do not shadow each other.

## Ownership

| Owner | Contract |
|---|---|
| `ClientMcpConnection` | Official SDK capability detection, direct lookup and core schemas, with host pagination that rejects repeated cursors and duplicate URIs. |
| `McpRuntimeService` / `McpCatalogService` | Existing connections, metadata, timeouts, cancellation and current configuration checks. |
| Builtin skills server | Request-scoped selected-server checks, current manifest retrieval and content verification. |
| Tool Approval | Ordinary tool policy, including the required loading policy; no additional Skill-specific rules. |
| Composer / IpcApi | Metadata-only discovery while the picker is open, cancellation on close and separate error rows for failed origins. |

Both runtimes use the same three tools. Pi exposes the builtin skills server directly. No remote directory enters the local skill library or native skill loader. The static manifest supplies the file inventory, so no directory tool is needed.

## Reading and integrity

`read_mcp_skill_file` accepts `server_id`, `skill_uri` and `resource_uri`. It needs no previous load: every call fetches the current manifest and requested bytes. Repeating a load or file read observes remote updates without reopening the session. There is no Skill session manager, activation state, version pin, content cache or persistence. Session identity is ordinary MCP interaction context only.

Manifest admission checks names, roots, containment, uniqueness, at most 512 files including `SKILL.md`, and a total of 16 MiB. Before fetching a file, the tool checks its root and membership in the current manifest. Responses must contain exactly the requested resource, with the declared byte length and SHA-256. Entry-file YAML must equal all advertised frontmatter fields, including unknown ones. Reads always use the selected originating MCP connection, never a direct HTTP or filesystem fetch.

Verification is scoped to one call. Separate reads can return different valid versions; discovery or another read does not cancel earlier calls or retract earlier text. Ordinary request cancellation and selected-server checks remain in force. There is no generic-resource interceptor.

## Permissions and limitations

Instructions and nested `SKILL.md` files are ordinary untrusted tool-result context. Frontmatter cannot install hooks or grant permissions. Loading does not change later execution, cron, delegation, local-skill or cross-origin resource policy. Listing and file reads use normal read-only tool policy; loading keeps its required-tool policy, including automatic pass in Full Access.

This scope deliberately omits the extension's acting-window activation and special execution/cross-origin approval model; it does not claim full host-policy compliance. Existing native history may retain older tool results, and fresh reads do not rewrite that history. No message provenance, history reconciliation, reusable grants or single-use Skill loading receipts are stored.

## Verification

`tests/helpers/mcpSkills.ts` supplies a real MCP peer for wire and tool tests. Focused coverage includes pagination, legacy compatibility, lazy reads without loading, current-version reads, binary attachments, containment, manifest membership, byte/frontmatter checks and separate origin failures. Existing runtime and approval tests cover ordinary policies. The on-demand Electron scenario exercises the picker, loading approval, supporting-file results and ordinary execution policy in both runtimes. Running that scenario and live-provider acceptance are separate from unit tests and builds.
