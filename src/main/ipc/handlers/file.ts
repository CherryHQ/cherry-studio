import { application } from '@application'
import {
  dispatchHandle,
  encodeTextEditContent,
  getMetadataByPath,
  readTextEditSnapshotByPath,
  safeOpen,
  showInFolder as showPathInFolder,
  StaleVersionError,
  TextEditSnapshotChangedError,
  TextEditUnsupportedError,
  writeTextEditIfUnchangedByPath
} from '@main/services/file'
import { hashData, PathStaleVersionError, PathUnsupportedAtomicWriteTargetError } from '@main/utils/file'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { fileRequestSchemas } from '@shared/ipc/schemas/file'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { type CreateInternalEntryIpcParams, TEXT_FILE_EDIT_MAX_BYTES } from '@shared/types/file'

function toTextEditIpcError(error: unknown): never {
  if (error instanceof StaleVersionError || error instanceof PathStaleVersionError) {
    throw new IpcError(fileErrorCodes.TEXT_EDIT_STALE, 'File changed after the editable snapshot was read', {
      expected: error.expected,
      current: error.current
    })
  }
  if (error instanceof TextEditSnapshotChangedError) {
    throw new IpcError(fileErrorCodes.TEXT_EDIT_STALE, error.message)
  }
  if (error instanceof TextEditUnsupportedError) {
    throw new IpcError(fileErrorCodes.TEXT_EDIT_UNSUPPORTED, error.message, { reason: error.reason })
  }
  if (error instanceof PathUnsupportedAtomicWriteTargetError) {
    throw new IpcError(fileErrorCodes.TEXT_EDIT_UNSUPPORTED, error.message, { reason: error.kind })
  }
  throw error
}

/**
 * Thin adapters for FileManager-backed file routes. Pure SQL file-entry reads stay
 * on DataApi; these handlers cover live FS metadata and user-triggered mutations.
 */
export const fileHandlers: IpcHandlersFor<typeof fileRequestSchemas> = {
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
  'file.read_text_snapshot': async (handle) => {
    const fileManager = application.get('FileManager')
    try {
      return await dispatchHandle(
        handle as FileHandle,
        async (entryId) => {
          await fileManager.getMetadata(entryId)
          return readTextEditSnapshotByPath(fileManager.getPhysicalPath(entryId))
        },
        readTextEditSnapshotByPath
      )
    } catch (error) {
      return toTextEditIpcError(error)
    }
  },
  'file.write_text_if_unchanged': async ({
    handle,
    content,
    lineEnding,
    hasBom,
    expectedVersion,
    expectedContentHash
  }) => {
    const fileManager = application.get('FileManager')
    try {
      return await dispatchHandle(
        handle as FileHandle,
        async (entryId) => {
          const target = fileManager.getPhysicalPath(entryId)
          const data = encodeTextEditContent(content, lineEnding, hasBom)
          if (data.byteLength > TEXT_FILE_EDIT_MAX_BYTES) {
            throw new TextEditUnsupportedError(target, 'too-large')
          }
          const version = await fileManager.writeIfUnchanged(entryId, data, expectedVersion, expectedContentHash)
          return { version, contentHash: await hashData(data) }
        },
        (target) =>
          writeTextEditIfUnchangedByPath(target, content, lineEnding, hasBom, expectedVersion, expectedContentHash)
      )
    } catch (error) {
      return toTextEditIpcError(error)
    }
  },
  'file.open': async (handle) => {
    const fileManager = application.get('FileManager')
    return dispatchHandle(handle as FileHandle, (entryId) => fileManager.open(entryId), safeOpen)
  },
  'file.show_in_folder': async (handle) => {
    const fileManager = application.get('FileManager')
    return dispatchHandle(handle as FileHandle, (entryId) => fileManager.showInFolder(entryId), showPathInFolder)
  }
}
