# Agent Note: Filesystem MCP authorizes every configured root

Status: implemented

English | [中文](2026-11-04-filesystem-mcp-multiple-roots.zh.md)

## Problem

The built-in `@cherry/filesystem` MCP stores line-separated configuration arguments in `mcp_server.args`, but `resolveFilesystemBaseDir` uses `args.find(...)` to select only the first non-empty argument. `createFileSystemServer(baseDir)` and its seven handlers capture one root, and `validatePath` checks canonical containment against that root alone. Only the first configured line is accessible; paths under the remaining roots fail with `Access denied: Path is outside the configured workspace root: <path>`. Reordering the lines only changes which root is first (Issue #23484).

## Decision

Configuration arguments form an ordered set of allowed roots. `resolveFilesystemBaseDirs` returns all non-empty, trimmed arguments. A non-empty, trimmed `WORKSPACE_ROOT` exclusively overrides the entire argument list as one root; it is never split on delimiters. With no configuration, the resolver returns an empty array and the server supplies the `feature.mcp.workspace` fallback.

The server applies `expandHome` to each root, retains only absolute paths, resolves and normalizes them, and deduplicates by exact normalized string while preserving order. Only an empty result falls back to the workspace. Each resulting root receives one best-effort recursive `mkdir` attempt per server creation. All seven handlers receive the resulting roots.

For an absolute target, `validatePath` canonicalizes the target once per validation and permits it when any configured root canonically contains it. For a relative target, it resolves candidates in root order and compares each candidate only with the root that generated it. An authorized missing candidate does not trigger a search for a same-named file under later roots. If every containment check fails, validation retains the exact access-denied message above.

When `path` is omitted, `ls`, `glob`, and `grep` still target the first valid root. Their `||` fallback also treats an empty string as omitted, and their tool descriptions state the default. Display paths use `getRelativePath`, relative to the first configured root whose canonical directory contains the canonical target; if no root matches, it returns the absolute target. In `grep`, relative ripgrep results resolve against the subprocess cwd (`process.cwd()`), then undergo validation against all configured roots.

## Alternatives considered

- Keeping only the first root preserves the defect itself.
- Searching every root by default in `glob` and `grep` requires new rules for cross-root deduplication, global ordering, and fairness of the 100-result truncation; that is outside this repair.
- Comparing each relative candidate against any root additionally authorizes cross-root paths and changes the previous relative-path semantics.
- Deduplicating by `realpath`, or removing overlapping or child roots, changes the default target and the root used for display paths.
- Searching later roots based on file existence can send reads and writes to different locations for the same relative name.

## Consequences

Multiple roots form a trust set, not isolation boundaries between roots. Access through a configured root to another configured root is allowed for targets validated against the full set, including absolute paths and traversal results. Relative candidates retain the paired-root rule above. A configured root that is itself a symlink authorizes its real directory. Every validation still canonicalizes paths anew; there is no startup cache, and the existing time-of-check/time-of-use (TOCTOU) limitation remains.

Two intentional visible changes accompany the repair: tool descriptions name the default target, and display paths for a single symlink-alias root become relative to its canonical directory. For example, the former `../real-root/f` becomes `f`. `WORKSPACE_ROOT` precedence, the unconfigured workspace fallback, single-root authorization semantics, tool names, input parameters, and transport remain unchanged.

## Verification

These measurements are supplied from the implementation run; this documentation-only run does not rerun tests.

- Regression — `src/main/ai/mcp/servers/filesystem/__tests__/filesystem.multiroot.test.ts` on a baseline copy before the fix: 9 failed / 3 passed. Every failure is the access-denied error above, rather than a collection failure or type error.
- Regression — After the fix, one run of `filesystem.multiroot.test.ts`, `filesystem.test.ts`, `grep.test.ts`, `saveAttachment.test.ts`, `moveToTrash.test.ts`, `assistantFileSafety.test.ts`, and `AssistantFileToolsServer.test.ts`: 7 files / 92 tests, all passing. The new test file exercises all seven tools under every root in both orders, default targets, outside-root rejection without writes, symlink escapes, relative-path selection, environment precedence and workspace fallback, traversal-result filtering, cwd-relative grep results, matching-root display paths, overlapping and aliased roots, home expansion, and distinct same-named grep results.

Not verified: real Electron end-to-end behavior, Windows drive-letter/junction behavior, or CI results.
