# Agent Note: Honor every configured filesystem MCP root

Status: implemented

English | [中文](2026-11-17-filesystem-multiple-roots.zh.md)

## Problem

The built-in filesystem MCP accepted multiple configured paths but treated only the first argument as its workspace. This prevented tools from accessing later authorized roots and made access depend on argument order.

## Decision

All non-empty configured path arguments are allowed roots. `WORKSPACE_ROOT`, when set, remains the single overriding root; with no configured root, the server uses the existing MCP workspace fallback. Path validation canonicalizes the target and checks containment against each root, preserving traversal and symlink escape protection.

## Alternatives considered

- Keep the first argument as the only root: this preserves the bug and differs from the accepted multi-path configuration.
- Treat the filesystem root as the workspace when multiple paths are supplied: this would grant access beyond the configured paths.

## Consequences

Tools can access any explicitly configured root regardless of argument order. Relative tool paths and default listings continue to use the first configured root; explicit paths may target any configured root.

## Verification

- Regression — `pnpm test:main src/main/ai/mcp/servers/filesystem/__tests__/filesystem.test.ts`: multiple roots work for `ls`, `read`, `write`, `glob`, and `grep`; configured roots remain order-independent; traversal and symlink escapes are rejected.
- Regression — `tsc --noEmit -p tsconfig.json`: TypeScript compilation passes.
