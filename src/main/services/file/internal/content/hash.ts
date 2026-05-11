/**
 * Compute content hash for a managed FileEntry or a raw FilePath.
 *
 * Algorithm: xxhash-h64 streamed via `@main/utils/file/fs.hash` —
 * non-cryptographic, fast, sufficient for the `writeIfUnchanged`
 * second-precision fallback that compares hashes when mtimes are ambiguous.
 *
 * ENOENT on an external entry transitions DanglingCache to 'missing' via the
 * shared `observeExternalAccess` wrapper before re-throwing.
 */

import { resolvePhysicalPath } from '@data/utils/pathResolver'
import { hash as fsHash } from '@main/utils/file/fs'
import type { FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

import type { FileManagerDeps } from '../deps'
import { observeExternalAccess } from '../observe'

export async function hash(deps: FileManagerDeps, id: FileEntryId): Promise<string> {
  const entry = await deps.fileEntryService.getById(id)
  const physicalPath = resolvePhysicalPath(entry)
  return observeExternalAccess(deps, entry, physicalPath, () => fsHash(physicalPath))
}

export async function hashByPath(_deps: FileManagerDeps, target: FilePath): Promise<string> {
  return fsHash(target)
}
