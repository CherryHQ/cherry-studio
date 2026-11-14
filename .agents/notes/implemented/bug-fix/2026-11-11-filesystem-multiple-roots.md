# Agent Note: Honor all configured filesystem MCP roots

Status: implemented

English | [中文](2026-11-11-filesystem-multiple-roots.zh.md)

## Problem

The built-in filesystem MCP factory selected only the first directory argument. A server configured with several directories therefore rejected absolute paths inside later directories. Passing the complete list requires an explicit containment rule so that restoring access does not grant access outside the configured directories.

## Decision

`resolveFilesystemBaseDirs` preserves a non-empty `WORKSPACE_ROOT` as the sole root. Otherwise it trims directory arguments, removes empty entries and duplicates, and preserves their order. The server expands home paths, retains absolute roots, and normalizes and deduplicates them. If none remain, it uses `application.getPath('feature.mcp.workspace')`. It attempts to create each root and logs creation failures.

All seven filesystem tools receive the same root list. Relative paths resolve against the first effective root; listing and searching without a path also use that root. Callers use absolute paths to address other roots. Relative names are not searched across roots.

`validatePath` canonicalizes the requested path and each root with the existing missing-path handling, then permits the path only when it equals or lies inside at least one canonical root. Comparisons remain exact rather than case-folded. A symlink target outside every allowed root is refused; a target inside another allowed root is within the configured boundary. This extends the existing containment decision without replacing it with a shared ancestor or a lexical prefix check.

## Alternatives considered

- Keep only the first argument: preserves the reported failure for additional configured directories.
- Allow the common ancestor of all roots: exposes sibling directories the user did not configure.
- Search every root for a relative filename: makes duplicate names ambiguous and changes existing first-root behavior.

## Consequences

Configured additional roots become accessible to read and mutation tools. Existing single-root calls and environment-variable precedence remain supported. Default searches start at the first root rather than traversing each configured root separately; followed symlinks can still reach another allowed root. Relative file labels from read, write, edit and delete use the most specific lexically containing configured root; labels are not authorization checks.

Canonicalization and file operations remain separate. This change does not establish protection against concurrent filesystem replacement between validation and use. It adds no database migration or persisted configuration format.

## Verification

- Regression — Static inspection of `factory.ts`, `filesystem/config.ts`, `filesystem/server.ts`, `filesystem/types.ts`, and all seven tool handlers confirms that configuration reaches the shared containment check and default paths retain first-root behavior.

- Regression — `pnpm exec vitest run --project main src/main/ai/mcp/servers/filesystem/__tests__/filesystem.test.ts src/main/utils/file/__tests__/path.test.ts`: 57 passed, 1 skipped on macOS with Node 24.12.0. Coverage includes additional-root reads, writes and listing, first-root relative lookup, outside-root rejection, and existing single-root containment and path canonicalization scenarios.

These local tests do not establish packaged Electron or Windows behavior. Search tests include mocked ripgrep output; they do not validate the real ripgrep binary.
