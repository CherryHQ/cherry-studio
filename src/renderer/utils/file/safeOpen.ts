import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { FileHandle } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'

const logger = loggerService.withContext('safeOpen')

/**
 * Safely open a file through Main's File IPC.
 *
 * Main owns the unsafe-extension policy. Renderer only provides the shared UX:
 * if default-open is blocked, reveal the file in the OS file manager instead.
 * Errors are logged here and rethrown so callers can decide how to notify users.
 */
export async function safeOpen(handle: FileHandle): Promise<void> {
  try {
    await ipcApi.request('file.open', handle)
  } catch (error) {
    if (error instanceof IpcError && error.code === fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE) {
      logger.warn('Blocked unsafe default-open; falling back to show in folder', { handle })
      try {
        await ipcApi.request('file.show_in_folder', handle)
      } catch (showError) {
        logger.error('Failed to show blocked file in folder', showError as Error)
        throw showError
      }
      return
    }

    logger.error('Failed to open file', error as Error)
    throw error
  }
}
