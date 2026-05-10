/**
 * Entry copy — produce a fresh internal entry whose content matches the source.
 *
 * Source can be internal or external. The copy is always an internal entry
 * (Cherry-owned), with a new UUIDv7 identifier and an optional renamed
 * display name. Implementation pipes through `createInternal({source:'path'})`
 * so it inherits the same write+rollback semantics.
 */

import { resolvePhysicalPath } from '@data/utils/pathResolver'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

import type { FileManagerDeps } from '../deps'
import { createInternal } from './create'

export interface CopyEntryParams {
  id: FileEntryId
  newName?: string
}

export async function copy(deps: FileManagerDeps, params: CopyEntryParams): Promise<FileEntry> {
  const src = await deps.fileEntryService.getById(params.id)
  const physical = resolvePhysicalPath(src) as FilePath
  const dst = await createInternal(deps, { source: 'path', path: physical })
  if (params.newName !== undefined && params.newName !== dst.name) {
    return deps.fileEntryService.update(dst.id, { name: params.newName })
  }
  return dst
}
