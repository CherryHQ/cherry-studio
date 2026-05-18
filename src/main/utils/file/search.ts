/* oxlint-disable no-unused-vars -- TODO(phase-2): stub exports deferred to Phase 2 alongside their consumer migrations; parameters shape the public signature but are unused until then. */

/**
 * Directory search — ripgrep + fuzzy matching.
 *
 * Only `listDirectory` is public. All ripgrep internals are private.
 *
 * Deferred to Phase 2 alongside its first consumer (KnowledgeService, Phase 2-C):
 * adding the ripgrep wrapper without a caller burns scope.
 */

import type { DirectoryListOptions, FilePath } from '@shared/file/types'

/** List contents of a directory with optional search/filter. */
export async function listDirectory(_dirPath: FilePath, _options?: DirectoryListOptions): Promise<string[]> {
  throw new Error('@main/utils/file/search.listDirectory: not implemented (deferred to Phase 2)')
}
