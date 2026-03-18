import type { MigrationStage } from '@shared/data/migration/v2/types'

import type { ExportProgress } from './exporters'

export const EXPORT_PROGRESS_WEIGHT = 18
export const MIGRATION_PROGRESS_WEIGHT = 82

export interface ExportState {
  status: 'idle' | 'running' | 'completed' | 'failed'
  currentTask?: string
  completedSteps: number
  totalSteps: number
  activeStep: number
}

export const initialExportState: ExportState = {
  status: 'idle',
  completedSteps: 0,
  totalSteps: 0,
  activeStep: 0
}

export function getCurrentStep(stage: MigrationStage): number {
  switch (stage) {
    case 'introduction':
      return 1
    case 'backup_required':
    case 'backup_progress':
    case 'backup_confirmed':
      return 2
    case 'migration':
      return 3
    case 'migration_completed':
    case 'completed':
      return 4
    case 'error':
      return 3
    default:
      return 1
  }
}

export function isMainMigrationStage(stage: MigrationStage): boolean {
  return stage === 'migration' || stage === 'migration_completed' || stage === 'completed' || stage === 'error'
}

export function isCloseAllowed(stage: MigrationStage): boolean {
  return stage !== 'backup_progress' && stage !== 'migration'
}

export function getExportTaskTranslationKey(task?: string): string | null {
  switch (task) {
    case 'redux_state':
      return 'migration.tables.redux_state'
    case 'topics':
      return 'migration.tables.topics'
    case 'files':
      return 'migration.tables.files'
    case 'knowledge_notes':
      return 'migration.tables.knowledge_notes'
    case 'message_blocks':
      return 'migration.tables.message_blocks'
    case 'settings':
      return 'migration.tables.settings'
    case 'translate_history':
      return 'migration.tables.translate_history'
    case 'quick_phrases':
      return 'migration.tables.quick_phrases'
    case 'translate_languages':
      return 'migration.tables.translate_languages'
    default:
      return null
  }
}

export function createInitialExportState(totalSteps: number): ExportState {
  return {
    status: 'running',
    currentTask: 'redux_state',
    completedSteps: 0,
    totalSteps,
    activeStep: totalSteps > 0 ? 1 : 0
  }
}

export function createDexieExportStartState(firstTable: string | undefined, totalSteps: number): ExportState {
  return {
    status: 'running',
    currentTask: firstTable,
    completedSteps: totalSteps > 0 ? 1 : 0,
    totalSteps,
    activeStep: totalSteps > 1 ? 2 : totalSteps
  }
}

export function getNextDexieExportState(
  exportProgress: ExportProgress,
  tablesToExport: string[],
  totalSteps: number
): ExportState {
  const tableIndex = Math.max(0, tablesToExport.indexOf(exportProgress.table))
  const completedTables = exportProgress.progress === 0 ? tableIndex : exportProgress.progress

  return {
    status: 'running',
    currentTask: exportProgress.table,
    completedSteps: Math.min(1 + completedTables, totalSteps),
    totalSteps,
    activeStep: Math.min(tableIndex + 2, totalSteps)
  }
}
