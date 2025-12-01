/**
 * Hook for subscribing to migration progress updates
 */

import {
  MigrationIpcChannels,
  type MigrationProgress,
  type MigrationStage,
  type MigratorStatus
} from '@shared/data/migration/v2/types'
import { useCallback, useEffect, useState } from 'react'

// Re-export types for convenience
export type { MigrationProgress, MigrationStage, MigratorStatus }

const initialProgress: MigrationProgress = {
  stage: 'introduction',
  overallProgress: 0,
  currentMessage: 'Ready to start data migration',
  migrators: []
}

export function useMigrationProgress() {
  const [progress, setProgress] = useState<MigrationProgress>(initialProgress)
  const [lastError, setLastError] = useState<string | null>(null)

  useEffect(() => {
    // Listen for progress updates from Main process
    const handleProgress = (_: unknown, progressData: MigrationProgress) => {
      setProgress(progressData)
      if (progressData.error) {
        setLastError(progressData.error)
      }
    }

    window.electron.ipcRenderer.on(MigrationIpcChannels.Progress, handleProgress)

    // Request initial progress
    window.electron.ipcRenderer
      .invoke(MigrationIpcChannels.GetProgress)
      .then((initialProgress: MigrationProgress) => {
        if (initialProgress) {
          setProgress(initialProgress)
        }
      })
      .catch(console.error)

    // Check for last error
    window.electron.ipcRenderer
      .invoke(MigrationIpcChannels.GetLastError)
      .then((error: string | null) => {
        if (error) {
          setLastError(error)
        }
      })
      .catch(console.error)

    return () => {
      window.electron.ipcRenderer.removeAllListeners(MigrationIpcChannels.Progress)
    }
  }, [])

  // Local state transition for confirming migration completion (frontend only)
  const confirmComplete = useCallback(() => {
    setProgress((prev) => ({
      ...prev,
      stage: 'completed',
      currentMessage: 'Migration completed successfully! Click restart to continue.'
    }))
  }, [])

  // Stage helpers
  const isInProgress = progress.stage === 'migration'
  const isCompleted = progress.stage === 'completed'
  const isError = progress.stage === 'error'
  const canCancel = progress.stage === 'introduction' || progress.stage === 'backup_required'

  return {
    progress,
    lastError,
    isInProgress,
    isCompleted,
    isError,
    canCancel,
    confirmComplete
  }
}

/**
 * Hook for migration actions
 */
export function useMigrationActions() {
  const proceedToBackup = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.ProceedToBackup)
  }, [])

  const confirmBackup = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.BackupCompleted)
  }, [])

  const showBackupDialog = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.ShowBackupDialog)
  }, [])

  const startMigration = useCallback(async (reduxData: Record<string, unknown>, dexieExportPath: string) => {
    // Send Redux data
    await window.electron.ipcRenderer.invoke(MigrationIpcChannels.SendReduxData, reduxData)

    // Send Dexie export path
    await window.electron.ipcRenderer.invoke(MigrationIpcChannels.DexieExportCompleted, dexieExportPath)

    // Start migration
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.StartMigration)
  }, [])

  const retry = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.Retry)
  }, [])

  const cancel = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.Cancel)
  }, [])

  const restart = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.Restart)
  }, [])

  return {
    proceedToBackup,
    confirmBackup,
    showBackupDialog,
    startMigration,
    retry,
    cancel,
    restart
  }
}
