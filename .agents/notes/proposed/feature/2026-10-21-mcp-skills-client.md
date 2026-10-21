# Agent Note: MCP Skills client for Agent sessions

Status: proposed

English | [中文](2026-10-21-mcp-skills-client.zh.md)

## Problem

Cherry connects to MCP servers, but its connection boundary has no Skills extension operations. The builtin `skills` server searches marketplaces and installs local skills; it does not consume remote skill manifests. Claude Code discovers local skill directories through a whitelist, and Pi receives local `additionalSkillPaths`. Copying remote content into those directories would erase its origin and load files before they are needed.

This proposal adds client consumption of `io.modelcontextprotocol/skills` to the two registered Agent runtimes, Claude Code and Pi. Serving Cherry skills to external clients, marketplace installation changes, and Assistant chat integration are outside this proposal.

## Proposal

### Protocol boundary

Use the [stable upstream specification](https://github.com/modelcontextprotocol/ext-skills/blob/c1aa87e4c381c82b99aa37471d0eae4ab50f9985/specification/stable/skills.mdx), targeting base protocol `2026-07-28`. Inspect advertised capabilities before sending extension methods; legacy or non-advertising servers retain their existing tools, prompts, and resources behavior.

The installed `@modelcontextprotocol/client@2.3.0` and the inspected npm `2.3.1` exports lack the documented dedicated Skills entry point. The installed SDK does expose `request(request, resultSchema, options)` for extension methods. Use that public API inside `ClientMcpConnection`, with narrow schemas for `skills/list`, `skills/get`, and optional `resources/directory/read`. Keep transport, metadata, cancellation, authentication, and era negotiation in the existing SDK path. Do not patch SDK internals or start another connection. Prefer the dedicated upstream API once an installable version provides equivalent behavior; that substitution is not a prerequisite for this proposal.

Follow pagination to completion without assuming the result enumerates every skill the server serves. Support direct lookup by URI on a selected server, including a URI from server instructions. Preserve unknown frontmatter fields. Validate manifests, root/name relationships, duplicate resources, and resource containment before admitting entries. Accept the specified boundary of 512 files and 16 MiB per skill. Decline `resources: "dynamic"` with a visible explanation in this first implementation.

### Ownership and user flow

`McpRuntimeService` owns connection access and invalidation. `McpCatalogService` projects remote skill metadata. A lifecycle-managed owner under `src/main/ai/skills/` owns verified reads, per-session provenance, and held manifests. SDK objects remain private to `connections/`; renderer commands use IpcApi. This version adds no SQLite table or persisted remote-skill installation record. Before returning verified instructions, store origin and manifest facts in the existing private message JSON field `data.mcpSkills`; public reads/writes cannot expose, forge, or erase them. Native forks retain these facts, while approval decisions are per call and cached file content remains memory-only.

Discover metadata only from active MCP servers selected for the Agent. Present remote skills in the existing Agent skill selection surface, labeled with the Cherry-assigned server label and distinguishing URI path. Identity is always `(serverId, skillUri)`, never a name alone. Local skills and same-named remote entries remain separate choices. Selection requests use in the current session; it does not install the skill or authorize execution.

The model discovers names, descriptions, and origin labels through a shared host-owned tool interface, then loads a skill and reads supporting files on demand. Claude Code and Pi adapt that interface without adding remote directories to their native local-skill loaders. Route catalog and content failures back to the user and model with their originating server; a failed listing is not a successful empty catalog.

### Loading, tool approval, and reads

Expose `list_mcp_skills`, `load_mcp_skill`, and `read_mcp_skill_file` through the existing builtin skills server. The initial model context needs only these tool definitions; discovery returns names, descriptions, server identities, and URIs on demand. Loading returns the entry and verified `SKILL.md` together, including the complete file manifest, without eagerly fetching supporting files. A known server and URI can bypass listing.

Use the existing Tool Approval registry, runtime events, and composer cards. Listing and same-origin reads are read-only tools; loading follows the normal required-tool policy, including Full Access. Delete the independent elicitation/consent workflow and reusable execution grants. While remote instructions are active, host code-execution calls require explicit per-call approval, except in Full Access. Nested activation and cross-origin resource reads require explicit per-call tool approval too, except in Full Access. Full Access passes these operations automatically; integrity and origin checks remain enforced. This intentionally relaxes the specification’s explicit-approval requirement in that mode. These decisions never persist or authorize later calls. Ignore remote frontmatter that would grant permissions or install hooks.

Fetch `SKILL.md` through `resources/read`, verify raw byte length and SHA-256, and compare parsed YAML frontmatter with the manifest. Return verified content with its origin as ordinary model context. Merely previewing or generically reading a resource never activates it. Reject malformed or unverifiable content before it enters the loading path.

Keep a held manifest for as long as loaded instructions may remain in context; conservatively use the session lifetime. Fetch supporting files only when read, verifying against that same manifest. Resolve relative paths from the loaded skill's own root and reject escapes. Route reads through the originating server even for HTTPS or file-shaped resource URIs; never fetch those URIs directly. Directory results cannot extend the held manifest. Expose the complete file manifest in the load result; no separate model-facing directory method is needed.

Use a per-session memory cache initially, bounded by the manifest limits for each skill. Do not create files in any filesystem-skill discovery path. Generic resource reads triggered while remote skills are active must enforce origin boundaries too; outside Full Access, a cross-origin read requires per-call tool approval identifying both servers. A single-origin load cannot authorize another origin through a generic tool.

If files or a refreshed manifest change, invalidate the held entry, cancel pending approvals, and stop further reads or execution under that entry. Show the changed skill and require a new session for the replacement. Do not mix replacement content into context still acting on the old entry: start a fresh runtime context before loading the replacement. Disabling or removing a server, changing its connection/authentication configuration, or deselecting it cancels pending work and prevents late results from repopulating the catalog or granting consent. A session restore or fork carries origin and manifest facts but no reusable approvals. Resuming ordinary conversation does not prompt; subsequent code execution follows the current permission mode. Operations requiring approval fail closed without an interactive responder.

### Delivery and verification

The user explicitly waived the Spec approval gate for this implementation. Deliver a protocol/host layer followed by runtime and UI integration. The feature is complete only after both layers pass the acceptance criteria. Put the controllable MCP fixture under `tests/helpers/` so focused integration tests and Electron tests share it. Use real client/server exchanges and scripted model turns to establish user-visible behavior without relying on provider output. Run only explicit affected test files locally; CI owns broader coverage.

## Alternatives considered

- Treat remote skills as ordinary resources: preserves reading but omits activation, manifest verification, and origin-bound consent.
- Download into the local skill library: conflicts with lazy retrieval and makes remote instructions indistinguishable from trusted local discovery.
- Wait for the dedicated SDK export: avoids local wire schemas but blocks an extension already supported by the SDK's public request API. Keep the adapter narrow and replaceable.
- Persist approvals and skill content immediately: adds storage, migration, and restart trust contracts without being necessary for initial use. Start with session-scoped state and explicit restore handling.

## Acceptance criteria

- AC1 — Advertising servers support paginated discovery and direct URI lookup through the existing connection; non-advertising and legacy servers receive no extension calls and retain existing functionality. (verification: unit)
- AC2 — Discovery and tool approval fetch no skill files; an approved load fetches only `SKILL.md`, and supporting files are fetched only when requested, with the full file inventory available without `directoryRead`. (verification: unit)
- AC3 — Two servers with the same URI, duplicate names within a server, and a same-named local skill stay independently addressable and visibly attributed; no choice silently shadows another. (verification: renderer)
- AC4 — Invalid manifests, root escapes, unlisted files, byte-length or digest mismatches, and frontmatter mismatches never become loaded content; valid 512-file and 16-MiB boundary manifests work, and dynamic entries report why they cannot load. (verification: unit)
- AC5 — Tool approval replaces independent consent; nested activation and each host code-execution call require explicit approval except in Full Access, and remote permission fields cannot widen access. (verification: unit)
- AC6 — Supporting and generic resource reads enforce origin; cross-origin access requires explicit per-call approval outside Full Access, and direct HTTP/filesystem fetching cannot bypass the originating MCP connection. (verification: unit)
- AC7 — Manifest replacement, cancellation, server disable/removal/reconfiguration, and session close reject late results and stale approvals; restore/fork preserves the per-call execution gate without prompting merely to resume and replacement loading uses a fresh context. (verification: unit)
- AC8 — In both Claude Code and Pi, a real MCP fixture and scripted model complete discovery, tool approval, skill loading, supporting-file reading, and a task whose result depends on the skill; rejection prevents loading, while Full Access completes loading and execution without a prompt. (verification: Electron)
- AC9 — Existing local skill activation and MCP tool/resource use remain functional; an unavailable remote skill is surfaced without blocking unrelated servers, and unattended operations obey the existing tool policy and automatically pass approval in Full Access. (verification: Electron)
- AC10 — The bilingual Spec, affected reference documentation, and localized UI text match delivered behavior; focused check results are recorded separately from CI and provider acceptance. (verification: docs gate)

## Risks

Runtime adapters can bypass a host policy if native tools are not routed through the same approval boundary. The implementation must verify actual Claude Code and Pi tool execution, not just the protocol helper. If either runtime cannot enforce the boundary through its supported APIs, improve that runtime integration before enabling remote skills there; do not silently downgrade the contract.

Session-wide held manifests deliberately overestimate how long instructions remain in context. Per-call execution approval and a fresh context on replacement add friction, but avoid pretending that already-injected instructions have been removed. Dynamic skills and Assistant chat remain explicit capability gaps rather than claims of universal support.
