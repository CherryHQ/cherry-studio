// useBackupV2 — renderer hook for the v2 modular backup export pipeline.
//
// Wraps window.api.backupV2.startBackup (BackupV2_StartBackup IPC) with loading /
// error state so a UI surface can bind a single onClick without re-deriving it.
//
// SLICE SCOPE: the v2 backup settings PAGE (a new V2 surface — intentionally NOT
// mixed into the legacy v1 LocalBackupSettings, which is throwaway under the v2
// refactor) lands in a follow-up UX slice. This hook is the consumer-side binding
// that keeps the preload wrapper from being orphaned (demand-first).

import { useCallback, useState } from 'react'

export interface UseBackupV2State {
  readonly loading: boolean
  readonly error: string | null
  readonly archivePath: string | null
}

/** Minimal result shape the renderer consumes (manifest stays main-side for now). */
export interface BackupV2Result {
  readonly archivePath: string
}

const INITIAL: UseBackupV2State = { loading: false, error: null, archivePath: null }

/**
 * Trigger a v2 .cbu export. Full preset only this slice (lite is gated off in the
 * orchestrator — needs the FK-aware contributor strip). The hook owns the request
 * lifecycle; `startBackup` resolves with the archive path on success and rethrows
 * (after recording the message in `error`) on failure.
 */
export function useBackupV2() {
  const [state, setState] = useState<UseBackupV2State>(INITIAL)

  const startBackup = useCallback(
    async (preset: 'full', outputPath: string): Promise<BackupV2Result> => {
      setState({ loading: true, error: null, archivePath: null })
      try {
        const result = (await window.api.backupV2.startBackup({ preset, outputPath })) as BackupV2Result
        setState({ loading: false, error: null, archivePath: result.archivePath })
        return result
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setState({ loading: false, error: message, archivePath: null })
        throw e
      }
    },
    []
  )

  return { ...state, startBackup }
}
