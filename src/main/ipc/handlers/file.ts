import { application } from '@application'
import type { fileRequestSchemas } from '@shared/ipc/schemas/file'
import type { IpcHandlersFor } from '@shared/ipc/types'
import type { CreateInternalEntryIpcParams } from '@shared/types/file/ipc'

/**
 * Thin adapters for FileManager-backed file routes. Pure SQL file-entry reads stay
 * on DataApi; these handlers cover live FS metadata and user-triggered mutations.
 */
export const fileHandlers: IpcHandlersFor<typeof fileRequestSchemas> = {
  'file.batch_get_metadata': async ({ ids }) => {
    const fileManager = application.get('FileManager')
    const pairs = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await fileManager.getMetadata(id)] as const
        } catch {
          return [id, null] as const
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
          return [id, await fileManager.getPhysicalPath(id)] as const
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
  'file.rename': async ({ id, newName }) => application.get('FileManager').rename(id, newName),
  'file.open': async ({ id }) => application.get('FileManager').open(id),
  'file.show_in_folder': async ({ id }) => application.get('FileManager').showInFolder(id)
}
