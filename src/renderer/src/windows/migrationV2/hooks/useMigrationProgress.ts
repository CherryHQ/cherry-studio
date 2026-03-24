/**
 * Hook for subscribing to migration progress updates
 */

import { loggerService } from '@renderer/services/LoggerService'
import {
  type MigrationBackupMode,
  MigrationIpcChannels,
  type MigrationProgress,
  type MigrationStage,
  type MigratorStatus
} from '@shared/data/migration/v2/types'
import { useCallback, useEffect, useState } from 'react'

// Re-export types for convenience
export type { MigrationProgress, MigrationStage, MigratorStatus }

const logger = loggerService.withContext('useMigrationProgress')

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
        return
      }

      if (progressData.stage !== 'failed') {
        setLastError(null)
      }
    }

    const removeProgressListener = window.electron.ipcRenderer.on(MigrationIpcChannels.Progress, handleProgress)

    // Request initial progress
    window.electron.ipcRenderer
      .invoke(MigrationIpcChannels.GetProgress)
      .then((initialProgress: MigrationProgress) => {
        if (initialProgress) {
          setProgress(initialProgress)
        }
      })
      .catch((error) => {
        logger.error('Failed to load initial migration progress', error as Error)
      })

    // Check for last error
    window.electron.ipcRenderer
      .invoke(MigrationIpcChannels.GetLastError)
      .then((error: string | null) => {
        if (error) {
          setLastError(error)
        }
      })
      .catch((error) => {
        logger.error('Failed to load last migration error', error as Error)
      })

    return () => {
      removeProgressListener()
    }
  }, [])

  return {
    progress,
    lastError
  }
}

/**
 * Hook for migration actions
 */
export function useMigrationActions() {
  const goBack = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.GoBack)
  }, [])

  const proceedToBackup = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.ProceedToBackup)
  }, [])

  const confirmBackup = useCallback((mode: MigrationBackupMode = 'existing') => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.BackupCompleted, mode)
  }, [])

  const showBackupDialog = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.ShowBackupDialog)
  }, [])

  const prepareMigration = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.PrepareMigration)
  }, [])

  const startMigration = useCallback(
    async (reduxData: Record<string, unknown>, dexieExportPath: string, localStorageExportPath?: string) => {
      // Send Redux data
      await window.electron.ipcRenderer.invoke(MigrationIpcChannels.SendReduxData, reduxData)

      // Send Dexie export path
      await window.electron.ipcRenderer.invoke(MigrationIpcChannels.DexieExportCompleted, dexieExportPath)

      // Send localStorage export path (if available)
      if (localStorageExportPath) {
        await window.electron.ipcRenderer.invoke(
          MigrationIpcChannels.LocalStorageExportCompleted,
          localStorageExportPath
        )
      }

      // Start migration
      return window.electron.ipcRenderer.invoke(MigrationIpcChannels.StartMigration)
    },
    []
  )

  const confirmMigrationResult = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.ConfirmMigrationResult)
  }, [])

  const reportFailure = useCallback((errorMessage: string) => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.ReportFailure, errorMessage)
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
    goBack,
    proceedToBackup,
    confirmBackup,
    showBackupDialog,
    prepareMigration,
    startMigration,
    confirmMigrationResult,
    reportFailure,
    retry,
    cancel,
    restart
  }
}
