# Fuzzy Search for Directory Listings

Cherry Studio exposes directory listing and fuzzy search through
`listDirectory()` and `listDirectoryEntries()` in
`src/main/services/file/tree/search.ts`. Both functions run in the main process;
renderers receive bounded results instead of building their own filesystem
indexes.

## Modes

The value of `searchPattern` selects one of two modes:

- **List mode** (`searchPattern: '.'`, the default) enumerates the requested
  files and directories. Results are not capped unless the caller supplies
  `maxEntries`.
- **Fuzzy search mode** (any other non-empty pattern) matches and scores files
  and directories together. Callers that render a bounded surface should
  always supply `maxEntries`.

Both modes respect recursion, depth, hidden-entry, file/directory, exclusion,
and result-limit options. Returned paths use forward slashes on every platform.

## Fuzzy Matching

For files, the query is first converted to a ripgrep glob that preserves
subsequence order:

```text
Query: updater
Glob:  *u*p*d*a*t*e*r*
```

Ripgrep provides a fast candidate set. JavaScript then applies the same
case-insensitive subsequence rule used for directories. If the pre-filter
produces no valid match, the implementation scans the remaining eligible files
and applies that same rule; there is no separate greedy matcher.

Directories are traversed directly, so a directory-only query does not depend
on ripgrep. File and directory candidates are merged before sorting and before
`maxEntries` is applied.

## Ranking

Candidates are scored using their path relative to the requested root. This
prevents characters in a workspace's parent path from affecting either
matching or ranking.

The score rewards, in order of influence:

1. A filename that starts with or contains the query.
2. Path segments that contain the query as a subsequence.
3. Consecutive matching characters and word-boundary matches.
4. Shorter paths through a logarithmic length penalty.

Directories win ties against files; remaining ties use path order.

## Options

The public `DirectoryListOptions` contract is defined in
`src/shared/types/file/common.ts`:

```typescript
interface DirectoryListOptions {
  recursive?: boolean // default: true
  maxDepth?: number // default: 10; 0 means unlimited
  includeHidden?: boolean // default: false
  includeFiles?: boolean // default: true
  includeDirectories?: boolean // default: true
  maxEntries?: number // default: unlimited
  searchPattern?: string // default: '.'
}
```

Fuzzy matching is the main-process behavior for a non-default search pattern;
it is not a renderer-configurable option.

## Usage

```typescript
const entries = await window.api.file.listDirectoryEntries(rootPath, {
  recursive: true,
  maxDepth: 3,
  includeFiles: true,
  includeDirectories: true,
  searchPattern: 'updater',
  maxEntries: 40
})
```

Use `listDirectoryEntries()` when the caller needs to distinguish files from
directories without additional IPC calls. Use `listDirectory()` when paths
alone are sufficient.

## Exclusions and Errors

Common generated or dependency directories such as `node_modules`, `.git`,
`dist`, `build`, `.next`, `.nuxt`, `coverage`, and `.cache` are excluded.
Hidden entries are excluded unless `includeHidden` is true.

Ripgrep exit code `1` means no matches. Exit codes `2` and above, missing
binaries, and signal termination are surfaced as errors so callers can decide
whether to show partial results or an error state.
