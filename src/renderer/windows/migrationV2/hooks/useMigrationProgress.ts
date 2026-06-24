/**
 * Hook for subscribing to migration progress updates
 */

import {
  MigrationIpcChannels,
  type MigrationProgress,
  type MigrationStage,
  type MigratorStatus,
  type StartMigrationPayload
} from '@shared/data/migration/v2/types'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const migrationStageStartedAtRef = useRef<number | null>(null)

  const applyMigrationStageTiming = useCallback((progressData: MigrationProgress): MigrationProgress => {
    if (progressData.stage === 'migration') {
      if (migrationStageStartedAtRef.current === null) {
        migrationStageStartedAtRef.current = performance.now()
      }
      return progressData
    }

    if (progressData.stage === 'completed') {
      const startedAt = migrationStageStartedAtRef.current
      migrationStageStartedAtRef.current = null

      if (startedAt === null || !progressData.summary) {
        return progressData
      }

      return {
        ...progressData,
        summary: {
          ...progressData.summary,
          durationMs: Math.max(0, performance.now() - startedAt)
        }
      }
    }

    migrationStageStartedAtRef.current = null
    return progressData
  }, [])

  useEffect(() => {
    // Listen for progress updates from Main process
    const handleProgress = (_: unknown, progressData: MigrationProgress) => {
      const nextProgress = applyMigrationStageTiming(progressData)
      setProgress(nextProgress)
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
          setProgress(applyMigrationStageTiming(initialProgress))
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
  }, [applyMigrationStageTiming])

  const returnToIntroduction = useCallback(() => {
    void window.electron.ipcRenderer.invoke(MigrationIpcChannels.ReturnToIntroduction)
  }, [])

  const returnToBackupChoice = useCallback(() => {
    void window.electron.ipcRenderer.invoke(MigrationIpcChannels.ReturnToBackupChoice)
  }, [])

  return {
    progress,
    lastError,
    returnToIntroduction,
    returnToBackupChoice
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

  const startMigration = useCallback(async (payload: StartMigrationPayload) => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.StartMigration, payload)
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

  const skipMigration = useCallback(() => {
    return window.electron.ipcRenderer.invoke(MigrationIpcChannels.SkipMigration)
  }, [])

  return {
    proceedToBackup,
    confirmBackup,
    showBackupDialog,
    startMigration,
    retry,
    cancel,
    restart,
    skipMigration
  }
}
