# Agent Note: Apply directory exclusions inside the selected root

Status: implemented

English | [中文](2026-11-07-directory-scan-root-boundary.zh.md)

## Problem

N-01 saved its note successfully but showed an empty Notes list after restart when the isolated profile lived under `.cache`. Directory listing passed an absolute root to ripgrep, whose default `!**/.cache/**` glob excluded the root's ancestors as well as its children. The same issue affected directories below `build` and fuzzy-search fallback scans.

## Decision

Run ripgrep with the requested directory as its working directory and `.` as its search operand. Resolve returned paths against that root so callers still receive normalized absolute paths. Let ripgrep enumerate eligible files with its native ignore discovery before JavaScript fuzzy matching. Enable ignore discovery outside Git repositories too. Positive query globs override ignore rules, while the root-only ignore predicate cannot honor nested exceptions; neither participates in fuzzy candidate filtering.

## Alternatives considered

Moving E2E profiles out of `.cache` would hide the defect for user-selected directories. Removing default exclusions would expose generated and cache files inside the selected directory. Duplicating ignore rules in the search module would let scan and watcher policy drift.

## Consequences

An excluded ancestor no longer empties a selected directory. Hidden files and excluded children remain filtered, and fuzzy search retains absolute-path results. Ripgrep owns file-search filtering, including nested `.gitignore` exceptions. JavaScript scores every eligible path instead of using a positive-glob pre-filter; no preference, storage format, or IPC contract changes.

## Verification

- Regression — `search.test.ts`: real ripgrep lists roots below `.cache` and `build`, preserves hidden/generated child exclusions and hidden opt-in, and finds cross-segment fuzzy matches. Root `*.md` with nested `!README.md` returns the retained file for filename and cross-segment queries, with and without Git metadata; the two Git-workspace cases failed before removing root-only post-filtering.
- Regression — `pnpm exec vitest run --project main src/main/services/file/tree/__tests__/search.test.ts src/main/services/file/tree/__tests__/builder.test.ts src/main/services/file/tree/__tests__/builder.events.test.ts src/main/services/file/tree/__tests__/builder.init.test.ts`: 69 passed.
- Electron — the preceding N-01 run reproduced an empty post-restart tree while its note file and Markdown content remained on disk. At `2fd3f18efc`, N-01 passed creation, autosave and post-restart rendering without a diagnostic observer; cleanup, report and selected-task gates passed and the owned runtime was removed. Full-suite acceptance remains separate.
