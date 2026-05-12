/**
 * Entry copy — produce a fresh internal entry whose content matches the source.
 *
 * Source can be internal or external. The copy is always an internal entry
 * (Cherry-owned), with a new UUIDv7 identifier and an optional renamed
 * display name. Implementation pipes through `createInternal({source:'path'})`
 * so it inherits the same write+rollback semantics.
 */

import { loggerService } from '@logger'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'

import { resolvePhysicalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'
import { createInternal } from './create'
import { permanentDelete } from './lifecycle'

const logger = loggerService.withContext('internal/entry/copy')

export interface CopyEntryParams {
  id: FileEntryId
  newName?: string
}

export async function copy(deps: FileManagerDeps, params: CopyEntryParams): Promise<FileEntry> {
  const src = await deps.fileEntryService.getById(params.id)
  const physical = resolvePhysicalPath(src)
  const dst = await createInternal(deps, { source: 'path', path: physical })
  if (params.newName === undefined || params.newName === dst.name) {
    return dst
  }
  // Rename step. `createInternal` already committed the new entry + its
  // physical blob; a rename failure here (e.g. SafeNameSchema rejecting an
  // unsafe newName) would leak the half-created entry. Roll back the create
  // on rename failure so `copy`'s contract is "all-or-nothing" — the caller
  // either gets the renamed entry or nothing at all. Cleanup failure is
  // best-effort: warn-log and rethrow the original rename error.
  try {
    return await deps.fileEntryService.update(dst.id, { name: params.newName })
  } catch (renameErr) {
    try {
      await permanentDelete(deps, dst.id)
    } catch (cleanupErr) {
      logger.warn('copy: rollback of post-create rename failure also failed; orphan entry may remain', {
        id: dst.id,
        renameErr,
        cleanupErr
      })
    }
    throw renameErr
  }
}
