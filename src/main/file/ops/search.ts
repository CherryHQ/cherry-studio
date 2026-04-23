/* oxlint-disable no-unused-vars -- TODO(phase-1b): Phase 1a stub exports; parameters shape the public signature but are unused until implementations land. */

/**
 * Directory search — ripgrep + fuzzy matching.
 *
 * Only `listDirectory` is public. All ripgrep internals are private.
 */

import type { DirectoryListOptions, FilePath } from '@shared/file/types'

/** List contents of a directory with optional search/filter. */
export async function listDirectory(_dirPath: FilePath, _options?: DirectoryListOptions): Promise<string[]> {
  throw new Error('ops.search.listDirectory: not implemented (Phase 1a stub, implementation lands in Phase 1b)')
}
