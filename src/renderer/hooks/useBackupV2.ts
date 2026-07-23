// useBackupV2 — renderer hook for the v2 modular backup export pipeline.
//
// Wraps the IpcApi routes (backup.start_backup / backup.cancel) + the backup.progress
// event with loading / error / progress / cancel state so a UI surface can bind a
// single onClick without re-deriving it.
//
// SLICE SCOPE: the v2 backup settings PAGE (a new V2 surface — intentionally NOT
// mixed into the legacy v1 LocalBackupSettings, which is throwaway under the v2
// refactor) lands in a follow-up UX slice. This hook is the consumer-side binding.

import { ipcApi } from '@renderer/ipc'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { BackupProgressUpdate } from '@shared/types/backup'
import { useCallback, useState } from 'react'

export interface UseBackupV2State {
  readonly loading: boolean
  readonly error: string | null
  readonly archivePath: string | null
  /** Active export id (cancel/progress routing key) — set from the first progress tick. */
  readonly backupId: string | null
  readonly progress: BackupProgressUpdate | null
  readonly cancelled: boolean
}

/** Minimal result shape the renderer consumes (manifest stays main-side). */
export interface BackupV2Result {
  readonly backupId: string
  readonly archivePath: string
}

/** Minimal restore result; restore stages then relaunches without a progress stream. */
export interface BackupV2RestoreResult {
  readonly restoreId: string
}

const INITIAL: UseBackupV2State = {
  loading: false,
  error: null,
  archivePath: null,
  backupId: null,
  progress: null,
  cancelled: false
}

/**
 * Trigger a v2 .cherrybackup export. Full = all domains + blobs; lite = 10 domains (no
 * KNOWLEDGE / PAINTINGS / FILE_STORAGE / TRANSLATE_HISTORY, no blobs — the
 * orchestrator's step 2.5 physically strips their rows from the copy).
 *
 * Subscribes to backup.progress for the export's lifetime (unsubscribes on
 * resolve/reject). The first tick carries backupId, which cancelBackup uses to
 * abort the active export.
 */
export function useBackupV2() {
  const [state, setState] = useState<UseBackupV2State>(INITIAL)

  const startBackup = useCallback(
    async (preset: 'full' | 'lite', outputPath: string, overwrite = false): Promise<BackupV2Result> => {
      setState({ ...INITIAL, loading: true })
      // Subscribe for THIS export; the first tick carries backupId (cancel routing).
      const unsubscribe = ipcApi.on('backup.progress', (update) => {
        setState((s) => ({ ...s, backupId: update.backupId, progress: update }))
      })
      try {
        const result = await ipcApi.request('backup.start_backup', { preset, outputPath, overwrite })
        setState({ ...INITIAL, backupId: result.backupId, archivePath: result.archivePath })
        return result
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        // Prefer the stable IpcError code (BACKUP_CANCELLED / BACKUP_INSUFFICIENT_DISK /
        // BACKUP_DISK_FULL) over regex on the message — BackupService.toIpcError maps
        // domain errors to codes at the IPC boundary. Fall back to /cancelled/i for any
        // path that still throws a bare cancel message.
        const code = e instanceof IpcError ? e.code : undefined
        const cancelled = code === backupErrorCodes.CANCELLED || /cancelled/i.test(message)
        setState({ ...INITIAL, error: message, cancelled })
        throw e
      } finally {
        unsubscribe()
      }
    },
    []
  )

  const cancelBackup = useCallback(async (): Promise<void> => {
    // No-op if no active export (backupId is set from the first progress tick).
    if (!state.backupId) return
    await ipcApi.request('backup.cancel', { backupId: state.backupId })
  }, [state.backupId])

  const startRestore = useCallback(
    async (archivePath: string): Promise<BackupV2RestoreResult> =>
      ipcApi.request('backup.start_restore', { archivePath }),
    []
  )

  return { ...state, startBackup, cancelBackup, startRestore }
}
