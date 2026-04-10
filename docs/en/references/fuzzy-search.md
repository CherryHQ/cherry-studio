# Fuzzy Search for File List

This document describes the fuzzy search implementation for file listing in Cherry Studio.

## Overview

The fuzzy search feature allows users to find files by typing partial or approximate file names/paths. It uses a two-tier file filtering strategy (ripgrep glob pre-filtering with greedy substring fallback) combined with subsequence-based scoring for optimal performance and flexibility.

## Features

- **Ripgrep Glob Pre-filtering**: Primary filtering using glob patterns for fast native-level filtering
- **Greedy Substring Matching**: Fallback file filtering strategy when ripgrep glob pre-filtering returns no results
- **Subsequence-based Segment Scoring**: During scoring, path segments gain additional weight when query characters appear in order
- **Relevance Scoring**: Results are sorted by a relevance score derived from multiple factors

## Matching Strategies

### 1. Ripgrep Glob Pre-filtering (Primary)

The query is converted to a glob pattern for ripgrep to do initial filtering:

```
Query: "updater"
Glob:  "*u*p*d*a*t*e*r*"
```

This leverages ripgrep's native performance for the initial file filtering.

### 2. Greedy Substring Matching (Fallback)

When the glob pre-filter returns no results, the system falls back to greedy substring matching. This allows more flexible matching:

```
Query: "updatercontroller"
File:  "packages/update/src/node/updateController.ts"

Matching process:
1. Find "update" (longest match from start)
2. Remaining "rcontroller" → find "r" then "controller"
3. All parts matched → Success
```

## Scoring Algorithm

Results are ranked by a relevance score based on named constants defined in `FileStorage.ts`:

| Constant | Value | Description |
|----------|-------|-------------|
| `SCORE_FILENAME_STARTS` | 100 | Filename starts with query (highest priority) |
| `SCORE_FILENAME_CONTAINS` | 80 | Filename contains exact query substring |
| `SCORE_SEGMENT_MATCH` | 60 | Per path segment that matches query |
| `SCORE_WORD_BOUNDARY` | 20 | Query matches start of a word |
| `SCORE_CONSECUTIVE_CHAR` | 15 | Per consecutive character match |
| `PATH_LENGTH_PENALTY_FACTOR` | 4 | Logarithmic penalty for longer paths |

### Scoring Strategy

The scoring prioritizes:
1. **Filename matches** (highest): Files where the query appears in the filename are most relevant
2. **Path segment matches**: Multiple matching segments indicate stronger relevance
3. **Word boundaries**: Matching at word starts (e.g., "upd" matching "update") is preferred
4. **Consecutive matches**: Longer consecutive character sequences score higher
5. **Path length**: Shorter paths are preferred (logarithmic penalty prevents long paths from dominating)

### Example Scoring

For query `updater`:

| File | Score Factors |
|------|---------------|
| `RCUpdater.js` | Short path + filename contains "updater" |
| `updateController.ts` | Multiple segment matches |
| `UpdaterHelper.plist` | Long path penalty |

## Configuration

### DirectoryListOptions

```typescript
interface DirectoryListOptions {
  recursive?: boolean      // Default: true
  maxDepth?: number        // Default: 10
  includeHidden?: boolean  // Default: false
  includeFiles?: boolean   // Default: true
  includeDirectories?: boolean // Default: true
  maxEntries?: number      // Default: 20
  searchPattern?: string   // Default: '.'
  fuzzy?: boolean          // Default: true
}
```

## Usage

```typescript
// Basic fuzzy search
const files = await window.api.file.listDirectory(dirPath, {
  searchPattern: 'updater',
  fuzzy: true,
  maxEntries: 20
})

// Disable fuzzy search (exact glob matching)
const files = await window.api.file.listDirectory(dirPath, {
  searchPattern: 'update',
  fuzzy: false
})
```

## Performance Considerations

1. **Ripgrep Pre-filtering**: Most queries are handled by ripgrep's native glob matching, which is extremely fast
2. **Fallback Only When Needed**: Greedy substring matching (which loads all files) only runs when glob matching returns empty results
3. **Result Limiting**: Only top 20 results are returned by default
4. **Excluded Directories**: Common large directories are automatically excluded:
   - `node_modules`
   - `.git`
   - `dist`, `build`
   - `.next`, `.nuxt`
   - `coverage`, `.cache`

## Implementation Details

The implementation is located in `src/main/services/FileStorage.ts`:

- `queryToGlobPattern()`: Converts query to ripgrep glob pattern
- `isFuzzyMatch()`: Subsequence matching algorithm
- `isGreedySubstringMatch()`: Greedy substring matching fallback
- `getFuzzyMatchScore()`: Calculates relevance score
- `listDirectoryWithRipgrep()`: Main search orchestration
