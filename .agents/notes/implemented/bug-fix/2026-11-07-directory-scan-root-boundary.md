# Agent Note: Apply directory exclusions inside the selected root

Status: implemented

English | [中文](2026-11-07-directory-scan-root-boundary.zh.md)

## Problem

N-01 saved its note successfully but showed an empty Notes list after restart when the isolated profile lived under `.cache`. Directory listing passed an absolute root to ripgrep, whose default `!**/.cache/**` glob excluded the root's ancestors as well as its children. The same issue affected directories below `build` and fuzzy-search fallback scans.

## Decision

Run ripgrep with the requested directory as its working directory and `.` as its search operand. Resolve returned paths against that root so callers still receive normalized absolute paths. Apply the existing gitignore predicate to fuzzy candidates, since a positive case-insensitive glob can override ripgrep's default exclusions. Hidden path segments are also checked relative to the selected root unless hidden entries were requested.

## Alternatives considered

Moving E2E profiles out of `.cache` would hide the defect for user-selected directories. Removing default exclusions would expose generated and cache files inside the selected directory. Duplicating ignore rules in the search module would let scan and watcher policy drift.

## Consequences

An excluded ancestor no longer empties a selected directory. Hidden files and excluded children remain filtered, and fuzzy search retains absolute-path results. The existing ignore library owns filtering; no preference, storage format, or IPC contract changes.

## Verification

- Regression — `search.test.ts`: real ripgrep lists roots below `.cache` and `build`, preserves hidden/generated child exclusions, and supports both fuzzy candidate and fallback paths. Ancestor exclusion and hidden-candidate cases reproduce failures before their corresponding repairs; fuzzy primary/fallback, hidden opt-in, and child-exclusion checks pass afterward.
- Regression — `pnpm exec vitest run --project main src/main/services/file/tree/__tests__/search.test.ts src/main/services/file/tree/__tests__/builder.test.ts src/main/services/file/tree/__tests__/builder.events.test.ts src/main/services/file/tree/__tests__/builder.init.test.ts`: 66 passed.
- Electron — the preceding N-01 run reproduced an empty post-restart tree while its note file and Markdown content remained on disk. At `2fd3f18efc`, N-01 passed creation, autosave and post-restart rendering without a diagnostic observer; cleanup, report and selected-task gates passed and the owned runtime was removed. Full-suite acceptance remains separate.
