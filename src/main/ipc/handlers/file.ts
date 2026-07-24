import { application } from '@application'
import {
  dispatchHandle,
  getMetadataByPath,
  readByPath,
  safeOpen,
  showInFolder as showPathInFolder,
  writeIfUnchangedByPath
} from '@main/services/file'
import { PathStaleVersionError } from '@main/utils/file'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { fileRequestSchemas } from '@shared/ipc/schemas/file'
import type { IpcHandlersFor } from '@shared/ipc/types'
import type { CreateInternalEntryIpcParams, FilePath } from '@shared/types/file'

/**
 * Thin adapters for FileManager-backed file routes. Pure SQL file-entry reads stay
 * on DataApi; these handlers cover live FS metadata and user-triggered mutations.
 */
export const fileHandlers: IpcHandlersFor<typeof fileRequestSchemas> = {
  'file.read': async ({ handle, options }) => {
    const fileManager = application.get('FileManager')
    return dispatchHandle(
      handle as FileHandle,
      (entryId) => fileManager.read(entryId, options),
      (path) => readByPath(path, options)
    )
  },
  'file.write_if_unchanged': async ({ path, data, expectedVersion }) => {
    try {
      return await writeIfUnchangedByPath(path as FilePath, data, expectedVersion)
    } catch (error) {
      if (error instanceof PathStaleVersionError) {
        throw new IpcError(fileErrorCodes.STALE_VERSION, error.message, {
          expected: error.expected,
          current: error.current
        })
      }
      throw error
    }
  },
  'file.batch_get_metadata': async ({ items }) => {
    const fileManager = application.get('FileManager')
    const pairs = await Promise.all(
      items.map(async ({ key, handle }) => {
        try {
          const metadata = await dispatchHandle(
            handle as FileHandle,
            (entryId) => fileManager.getMetadata(entryId),
            getMetadataByPath
          )
          return [key, metadata] as const
        } catch {
          return [key, null] as const
        }
      })
    )
    return Object.fromEntries(pairs)
  },
  'file.batch_get_physical_paths': async ({ ids }) => {
    const fileManager = application.get('FileManager')
    const pairs = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, fileManager.getPhysicalPath(id)] as const
        } catch {
          return [id, null] as const
        }
      })
    )
    return Object.fromEntries(pairs)
  },
  'file.batch_get_dangling_states': async ({ ids }) => application.get('FileManager').batchGetDanglingStates({ ids }),
  'file.batch_create_internal_entries': async ({ items }) =>
    application.get('FileManager').batchCreateInternalEntries(items as CreateInternalEntryIpcParams[]),
  'file.batch_trash': async ({ ids }) => application.get('FileManager').batchTrash(ids),
  'file.batch_restore': async ({ ids }) => application.get('FileManager').batchRestore(ids),
  'file.batch_permanent_delete': async ({ ids }) => application.get('FileManager').batchPermanentDelete(ids),
  'file.empty_trash': async () => application.get('FileManager').emptyTrash(),
  'file.rename': async ({ id, newName }) => application.get('FileManager').rename(id, newName),
  'file.open': async (handle) => {
    const fileManager = application.get('FileManager')
    return dispatchHandle(handle as FileHandle, (entryId) => fileManager.open(entryId), safeOpen)
  },
  'file.show_in_folder': async (handle) => {
    const fileManager = application.get('FileManager')
    return dispatchHandle(handle as FileHandle, (entryId) => fileManager.showInFolder(entryId), showPathInFolder)
  }
}
