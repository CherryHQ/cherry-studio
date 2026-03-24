import { type MigrationBackupMode, type MigrationStage } from '@shared/data/migration/v2/types'
import { useEffect, useReducer } from 'react'

import { type ExportState, initialExportState } from '../progress'

type MigrationViewRequestState = 'idle' | 'pending'

interface MigrationViewState {
  backupChoice: MigrationBackupMode
  startMigrationState: MigrationViewRequestState
  exportState: ExportState
  localError: string | null
}

type MigrationViewAction =
  | { type: 'SELECT_BACKUP_CHOICE'; payload: MigrationBackupMode }
  | { type: 'SYNC_BACKUP_CHOICE'; payload: MigrationBackupMode }
  | { type: 'RESET_TRANSIENT_STATE' }
  | { type: 'START_MIGRATION_REQUESTED' }
  | { type: 'SET_EXPORT_STATE'; payload: ExportState }
  | { type: 'START_MIGRATION_FAILED'; payload: string }
  | { type: 'START_MIGRATION_FINISHED' }

const initialViewState: MigrationViewState = {
  backupChoice: 'create',
  startMigrationState: 'idle',
  exportState: initialExportState,
  localError: null
}

function migrationViewReducer(state: MigrationViewState, action: MigrationViewAction): MigrationViewState {
  switch (action.type) {
    case 'SELECT_BACKUP_CHOICE':
    case 'SYNC_BACKUP_CHOICE':
      return {
        ...state,
        backupChoice: action.payload
      }

    case 'RESET_TRANSIENT_STATE':
      return {
        ...state,
        startMigrationState: 'idle',
        exportState: initialExportState,
        localError: null
      }

    case 'START_MIGRATION_REQUESTED':
      return {
        ...state,
        startMigrationState: 'pending',
        exportState: initialExportState,
        localError: null
      }

    case 'SET_EXPORT_STATE':
      return {
        ...state,
        exportState: action.payload
      }

    case 'START_MIGRATION_FAILED':
      return {
        ...state,
        startMigrationState: 'idle',
        exportState: {
          ...state.exportState,
          status: 'failed'
        },
        localError: action.payload
      }

    case 'START_MIGRATION_FINISHED':
      return {
        ...state,
        startMigrationState: 'idle'
      }

    default:
      return state
  }
}

/**
 * Renderer-only UI state for the migration window.
 * The main process remains the owner of the flow stage.
 */
export function useMigrationViewState(progressStage: MigrationStage, backupMode?: MigrationBackupMode) {
  const [state, dispatch] = useReducer(migrationViewReducer, initialViewState)

  useEffect(() => {
    if (!backupMode) {
      return
    }

    if (progressStage !== 'backup_in_progress' && progressStage !== 'backup_ready') {
      return
    }

    dispatch({
      type: 'SYNC_BACKUP_CHOICE',
      payload: backupMode
    })
  }, [backupMode, progressStage])

  return {
    state,
    selectBackupChoice: (choice: MigrationBackupMode) => {
      dispatch({
        type: 'SELECT_BACKUP_CHOICE',
        payload: choice
      })
    },
    resetTransientState: () => {
      dispatch({ type: 'RESET_TRANSIENT_STATE' })
    },
    startMigrationRequest: () => {
      dispatch({ type: 'START_MIGRATION_REQUESTED' })
    },
    setExportState: (exportState: ExportState) => {
      dispatch({
        type: 'SET_EXPORT_STATE',
        payload: exportState
      })
    },
    failStartMigration: (errorMessage: string) => {
      dispatch({
        type: 'START_MIGRATION_FAILED',
        payload: errorMessage
      })
    },
    finishStartMigration: () => {
      dispatch({ type: 'START_MIGRATION_FINISHED' })
    }
  }
}
