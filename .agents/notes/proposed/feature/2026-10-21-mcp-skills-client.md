# Agent Note: MCP Skills client for Agent sessions

Status: proposed

English | [中文](2026-10-21-mcp-skills-client.zh.md)

## Problem

Cherry connects to MCP servers but cannot discover and read their Skills extension workflows. Copying remote files into local skill directories erases their origin and fetches attachments before they are needed. Treating a read as lasting activation adds session state and approval policy unrelated to fetching instructions.

This proposal consumes `io.modelcontextprotocol/skills` in Claude Code and Pi through the existing builtin skills server. Serving local skills to external clients, marketplace installation changes, and Assistant chat are outside scope.

## Proposal

### Protocol boundary

Use the [stable upstream specification](https://github.com/modelcontextprotocol/ext-skills/blob/c1aa87e4c381c82b99aa37471d0eae4ab50f9985/specification/stable/skills.mdx), targeting protocol `2026-07-28`. Use the official SDK `SkillsClient` capability detection and direct lookup, plus core schemas and limits. Retain host pagination because the SDK's full-list helper silently returns partial results on repeated cursors. Legacy and non-advertising servers retain their ordinary behavior without extension calls.

Validate manifests, names, URI roots, resource containment and uniqueness, accepting the specified 512-file and 16-MiB boundaries. Preserve unknown frontmatter fields. Decline `resources: "dynamic"` with a visible explanation. Listing need not enumerate every skill: known URIs remain directly addressable.

### Ownership and user flow

The existing `McpRuntimeService` owns connections, cancellation, timeouts and configuration validation; `McpCatalogService` exposes metadata. The builtin skills server owns request-scoped loading and file verification. There is no separate Skill service, session activation map, version pin, verified-content cache, approval receipt, provenance record or retained-history scan. Session identity is only ordinary tool-call context for the existing MCP interaction host.

The composer lists metadata from active servers selected for the Agent and labels remote entries with server and URI. Identity is `(serverId, skillUri)`; local skills, duplicate names and identical URIs on different servers remain separate. Selection inserts a usage request without fetching files or installing anything.

Expose `list_mcp_skills`, `load_mcp_skill`, and `read_mcp_skill_file`. The initial prompt need not enumerate skills. Loading fetches the current manifest and verified `SKILL.md` together, including the complete file inventory. Supporting files are fetched only on demand. A file read accepts server, skill and resource URIs, fetches the current manifest, and needs no previous load. Repeated calls observe the current remote data rather than a session-held version.

### Integrity and ordinary tool policy

Fetch every file through its originating MCP connection, never through direct HTTP or filesystem access. Validate containment and manifest membership before requesting bytes. Require exactly the requested resource, matching byte length and SHA-256; entry-file YAML must equal all advertised frontmatter fields. Each call verifies against the manifest obtained by that call. No generic-resource interception or cross-call invalidation is needed.

Use the existing tool policies and approval cards. Loading retains its required-tool policy, including automatic pass in Full Access. Listing and file reads retain read-only policy. Remote frontmatter cannot install hooks or grant permissions. Loading instructions does not change subsequent execution, cron, delegation, local-skill or cross-origin resource policies. Nested `SKILL.md` files are ordinary Markdown. No Skill-specific approvals or invalidation listeners are added to Claude Code or Pi.

This deliberately omits the extension's acting-window activation and special execution/cross-origin approval model. It provides dynamic, verified text and attachment retrieval through normal tools rather than full host-policy compliance. Historical tool results remain ordinary conversation history; a fresh read does not rewrite earlier model context. Concurrent calls can return different valid versions, and changes discovered by one call do not revoke another call's results or approvals.

### Delivery and verification

The user explicitly authorized removing the activation model and waived the Spec approval gate. Update this existing proposal rather than introducing another owner. Use the shared real MCP fixture for protocol and host tests; run explicit affected test files locally. Electron and live-provider acceptance remain distinct from unit, build and CI results.

## Alternatives considered

- Session activation with pinned manifests and verified-content caches: adds state, invalidation, cross-tool execution classification and approval receipts for what is intended as dynamic text retrieval. Remove it rather than moving the same machinery into another owner.
- Persist activation or reconstruct it from message history: adds storage and restart trust contracts; earlier tool results remain ordinary history.
- Download into local skill directories: breaks lazy retrieval and loses remote origin.
- Replace every host check with SDK helpers: reuse official queries and schemas, but retain fail-closed pagination and existing byte/frontmatter checks at the tool boundary. SDK reads fetch independently and do not verify an already obtained resource response.
- Add `resources/directory/read`: the complete static manifest already supplies the file inventory; no current product flow needs another directory API.

## Acceptance criteria

- AC1 — Advertising servers support paginated discovery and direct lookup; legacy and non-advertising servers receive no extension calls. (verification: unit)
- AC2 — Discovery and loading approval fetch no files; loading reads only `SKILL.md`, and supporting files are fetched only when requested. (verification: unit)
- AC3 — Duplicate names, identical URIs on different servers, and same-named local skills remain independently addressable and visibly attributed. (verification: renderer)
- AC4 — Invalid manifests, root escapes, unlisted files, wrong resource responses, digest/size and frontmatter mismatches return errors; valid boundary manifests work and dynamic entries explain their limitation. (verification: unit)
- AC5 — Loading uses ordinary tool approval, including Full Access; loading and reading never grant permissions or add Skill-specific approval to later tools. (verification: unit)
- AC6 — Each file read uses its explicitly selected originating server and verifies the current manifest through the existing MCP connection, without requiring earlier loading. (verification: unit)
- AC7 — Repeated calls retrieve updated manifests and content without reopening or reloading; ordinary request cancellation and server-selection checks still reject invalid calls, with no cross-call activation state. (verification: unit)
- AC8 — A real MCP fixture and scripted model complete discovery, loading approval and lazy supporting-file reads in both runtimes; declining load fetches no files and Full Access skips the loading prompt. (verification: Electron)
- AC9 — Existing local skills and MCP tools/resources remain functional, and an unavailable origin is reported separately from a successful empty catalog. (verification: Electron)
- AC10 — The bilingual proposal and affected references describe the chosen request-scoped behavior and its limitations, with verification boundaries recorded accurately. (verification: docs gate)
- AC11 — No Skill-specific session lifecycle, cached activation, execution-tool classification, approval receipt or generic-resource interceptor remains in the host or runtime adapters. (verification: unit)

## Risks

Remote instructions are untrusted tool-result context. Ordinary tool policy remains the only execution approval boundary, and this scope does not implement the extension's special acting-window guarantees. Callers can mix versions across separate reads; a later read does not retract earlier instructions. Dynamic manifests and Assistant chat remain unsupported.
