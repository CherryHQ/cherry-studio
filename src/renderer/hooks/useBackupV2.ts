// useBackupV2 — renderer hook for the v2 modular backup export pipeline.
//
// Wraps window.api.backupV2 (BackupV2_StartBackup / CancelBackup /
// BackupV2_Progress event) with loading / error / progress / cancel state so a UI
// surface can bind a single onClick without re-deriving it.
//
// SLICE SCOPE: the v2 backup settings PAGE (a new V2 surface — intentionally NOT
// mixed into the legacy v1 LocalBackupSettings, which is throwaway under the v2
// refactor) lands in a follow-up UX slice. This hook is the consumer-side binding
// that keeps the preload wrapper from being orphaned (demand-first).

import { useCallback, useState } from 'react'

import type { BackupProgressUpdate } from '@shared/types/backup'

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

const INITIAL: UseBackupV2State = {
  loading: false,
  error: null,
  archivePath: null,
  backupId: null,
  progress: null,
  cancelled: false
}

/**
 * Trigger a v2 .cbu export. Full = all domains + blobs; lite = 10 domains (no
 * KNOWLEDGE / PAINTINGS / FILE_STORAGE / TRANSLATE_HISTORY, no blobs — the
 * orchestrator's step 2.5 physically strips their rows from the copy).
 *
 * Subscribes to BackupV2_Progress for the export's lifetime (unsubscribes on
 * resolve/reject). The first tick carries backupId, which cancelBackup uses to
 * abort the active export.
 */
export function useBackupV2() {
  const [state, setState] = useState<UseBackupV2State>(INITIAL)

  const startBackup = useCallback(
    async (preset: 'full' | 'lite', outputPath: string): Promise<BackupV2Result> => {
      setState({ ...INITIAL, loading: true })
      // Subscribe for THIS export; the first tick carries backupId (cancel routing).
      const unsubscribe = window.api.backupV2.onProgress((update) => {
        setState((s) => ({ ...s, backupId: update.backupId, progress: update }))
      })
      try {
        const result = await window.api.backupV2.startBackup({ preset, outputPath })
        setState({ ...INITIAL, backupId: result.backupId, archivePath: result.archivePath })
        return result
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const cancelled = /cancelled/i.test(message)
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
    await window.api.backupV2.cancelBackup(state.backupId)
  }, [state.backupId])

  return { ...state, startBackup, cancelBackup }
}
