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

Ripgrep enumerates eligible files once with `--files`, using the requested
recursion, depth, hidden-entry, and exclusion options. JavaScript then applies
case-insensitive subsequence matching to each file's path relative to the
requested root.

Matching the full relative path lets a query match a filename, an ancestor
directory segment, or characters spanning multiple path segments. For example,
`docs/readme.md` is a file match for `docs` even though `readme.md` does not
contain the query.

Directories are traversed directly, so a directory-only query does not depend
on ripgrep. They use the same root-relative subsequence rule as files. File and
directory candidates are merged before sorting and before `maxEntries` is
applied.

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

Ripgrep exit codes `0` and `1` are normal. When ripgrep exits with code `2` or
higher but produced usable stdout, the search keeps those partial results and
logs a warning with the traversal error. It throws when no usable stdout is
available, the binary is missing, or the process is terminated by a signal.
