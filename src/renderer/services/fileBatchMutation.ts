import { ipcApi } from '@renderer/ipc'
import { getErrorMessage } from '@renderer/utils/error'
import type { FileEntryId } from '@shared/data/types/file'
import type { OutputFor } from '@shared/ipc/types'

type FileBatchMutationResult = OutputFor<'file.batch_trash'>
type FileBatchMutationOutcome = FileBatchMutationResult & { requestFailed: boolean }
type FileBatchMutationRoute =
  | 'file.batch_trash'
  | 'file.batch_remove_from_library'
  | 'file.batch_restore'
  | 'file.batch_permanent_delete_from_trash'

// This is a renderer batching knob kept at or below the file IPC schema cap.
// Renderer services intentionally do not import the shared runtime schema registry.
const FILE_MUTATION_BATCH_SIZE = 500

export async function requestBatchedFileMutation(
  route: FileBatchMutationRoute,
  ids: readonly FileEntryId[]
): Promise<FileBatchMutationOutcome> {
  if (ids.length === 0) return { succeeded: [], failed: [], requestFailed: false }

  const chunks: FileEntryId[][] = []
  for (let index = 0; index < ids.length; index += FILE_MUTATION_BATCH_SIZE) {
    chunks.push(ids.slice(index, index + FILE_MUTATION_BATCH_SIZE))
  }

  const results = await Promise.allSettled(
    chunks.map((chunk) => {
      switch (route) {
        case 'file.batch_trash':
          return ipcApi.request('file.batch_trash', { ids: chunk })
        case 'file.batch_remove_from_library':
          return ipcApi.request('file.batch_remove_from_library', { ids: chunk })
        case 'file.batch_restore':
          return ipcApi.request('file.batch_restore', { ids: chunk })
        case 'file.batch_permanent_delete_from_trash':
          return ipcApi.request('file.batch_permanent_delete_from_trash', { ids: chunk })
      }
    })
  )

  const outcome: FileBatchMutationOutcome = { succeeded: [], failed: [], requestFailed: false }
  for (let index = 0; index < results.length; index += 1) {
    const settled = results[index]
    if (settled.status === 'fulfilled') {
      outcome.succeeded.push(...settled.value.succeeded)
      outcome.failed.push(...settled.value.failed)
      continue
    }

    outcome.requestFailed = true
    outcome.failed.push(...chunks[index].map((id) => ({ id, error: getErrorMessage(settled.reason) })))
  }

  return outcome
}
