import type {
  I18nMessage,
  MigrationBackupMode,
  MigrationBackupProgressStage,
  MigrationProgress
} from '@shared/data/migration/v2/types'

export interface BackupProcessData {
  stage: MigrationBackupProgressStage
  progress: number
  total: number
}

const backupProgressMessages: Record<
  MigrationBackupProgressStage,
  {
    currentMessage: string
    i18nMessage: I18nMessage
  }
> = {
  preparing: {
    currentMessage: 'Preparing backup data...',
    i18nMessage: { key: 'migration.backup.progress_stages.preparing' }
  },
  writing_data: {
    currentMessage: 'Writing backup metadata...',
    i18nMessage: { key: 'migration.backup.progress_stages.writing_data' }
  },
  copying_files: {
    currentMessage: 'Copying application data...',
    i18nMessage: { key: 'migration.backup.progress_stages.copying_files' }
  },
  preparing_compression: {
    currentMessage: 'Preparing backup compression...',
    i18nMessage: { key: 'migration.backup.progress_stages.preparing_compression' }
  },
  compressing: {
    currentMessage: 'Compressing backup archive...',
    i18nMessage: { key: 'migration.backup.progress_stages.compressing' }
  },
  completed: {
    currentMessage: 'Backup created successfully!',
    i18nMessage: { key: 'migration.backup.progress_stages.completed' }
  }
}

export function createBackupProgress(
  processData: BackupProcessData,
  filePath: string,
  mode: MigrationBackupMode = 'create'
): MigrationProgress {
  const { currentMessage, i18nMessage } = backupProgressMessages[processData.stage]

  return {
    stage: 'backup_progress',
    overallProgress: Math.max(0, Math.min(100, processData.progress)),
    currentMessage,
    i18nMessage,
    migrators: [],
    backupInfo: {
      mode,
      filePath,
      progressStage: processData.stage
    }
  }
}
