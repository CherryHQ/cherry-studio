/**
 * Directory search — ripgrep + fuzzy matching.
 *
 * Only `listDirectory` is public. All ripgrep internals are private.
 */

import type { DirectoryListOptions, FilePath } from '@shared/file/types'

/** List contents of a directory with optional search/filter. */
export async function listDirectory(_dirPath: FilePath, _options?: DirectoryListOptions): Promise<string[]> {
  throw new Error('Not implemented')
}
