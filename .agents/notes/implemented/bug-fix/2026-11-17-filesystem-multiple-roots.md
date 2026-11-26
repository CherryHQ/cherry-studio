# Agent Note: Honor every configured filesystem MCP root

Status: implemented

English | [中文](2026-11-17-filesystem-multiple-roots.zh.md)

## Problem

The built-in filesystem MCP accepted multiple configured paths but treated only the first argument as its workspace. This prevented tools from accessing later authorized roots and made access depend on argument order.

## Decision

All non-empty configured path arguments are allowed roots. `WORKSPACE_ROOT`, when set, remains the single overriding root; with no configured root, the server uses the existing MCP workspace fallback. Path validation canonicalizes the target and roots. Relative paths and default listings stay within the canonical first root, including discovered descendants; absolute requests may match any configured root. Descendant validation preserves the original request's root scope, preventing relative discovery through a symlink into another configured root. File operation output uses the canonical root selected during validation to report root-relative paths.

## Alternatives considered

- Keep the first argument as the only root: this preserves the bug and differs from the accepted multi-path configuration.
- Treat the filesystem root as the workspace when multiple paths are supplied: this would grant access beyond the configured paths.

## Consequences

Tools can access any explicitly configured root regardless of argument order. Relative tool paths and default listings continue to use the first configured root; absolute paths may target any configured root.

## Verification

- Regression — `pnpm exec vitest run --project main src/main/ai/mcp/servers/filesystem/__tests__/filesystem.test.ts src/main/ai/mcp/servers/filesystem/__tests__/grep.test.ts src/main/utils/file/__tests__/path.test.ts`: multiple roots work for explicit absolute requests; relative cross-root reads and mutations are denied without changing the target; symlink-root output stays root-relative. Real ripgrep and a labeled output fixture cover default and relative glob discovery without cross-root symlink results.
- Regression — `pnpm typecheck:node`: Node project typechecking passes.
