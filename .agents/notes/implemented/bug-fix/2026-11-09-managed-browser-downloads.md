# Agent Note: Keep managed Browser MCP downloads inside the filesystem workspace

Status: implemented

English | [中文](2026-11-09-managed-browser-downloads.zh.md)

## Problem

Managed Browser MCP downloads followed Electron's OS-default save location. The default filesystem MCP is confined to `feature.mcp.workspace`, so it could not open those downloaded files.

## Decision

Managed Browser MCP downloads are saved in `feature.mcp.workspace` using the suggested basename. An existing or concurrently downloading file is never replaced: the download gets the next free name (`report (1).txt`) and that name is reported in the tool result. Borrowed guest downloads retain Electron's normal save flow.

## Alternatives considered

- Allow the filesystem MCP to read arbitrary OS download paths: this would weaken its workspace boundary.
- Redirect every guest download: this would change user-owned browser behavior.

## Consequences

- The default filesystem MCP can access managed Browser MCP downloads by filename; a custom filesystem workspace does not automatically gain access.
- Managed Browser MCP downloads no longer use the OS-default download location. Borrowed guest downloads are unchanged.

## Verification

- Regression — `pnpm test:main src/main/features/browser/__tests__/downloads.test.ts`: managed downloads target the filesystem workspace, an existing or in-flight file keeps its contents while the download takes a new name, and borrowed downloads are untouched.
