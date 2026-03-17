import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@renderer/services/LoggerService'
import { MigrationIpcChannels, type MigrationStage } from '@shared/data/migration/v2/types'
import { ArrowRight, RefreshCw } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type BackupChoice,
  MigrationBackupStep,
  MigrationCompletedStep,
  MigrationErrorStep,
  MigrationFooter,
  MigrationHeader,
  MigrationOverviewStep,
  MigrationRunStep
} from './components'
import { DexieExporter, ReduxExporter } from './exporters'
import { useMigrationActions, useMigrationProgress } from './hooks/useMigrationProgress'

const logger = loggerService.withContext('MigrationApp')

const totalSteps = 4
const languageOptions = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en-US', label: 'English' }
] as const
const footerPrimaryButtonClassName = 'min-h-10 rounded-md px-4 shadow-none'
const footerSecondaryButtonClassName =
  'min-h-10 rounded-md px-3.5 text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground'
const EXPORT_PROGRESS_WEIGHT = 18
const MIGRATION_PROGRESS_WEIGHT = 82

interface ExportState {
  status: 'idle' | 'running' | 'completed' | 'failed'
  currentTask?: string
  completedSteps: number
  totalSteps: number
}

const initialExportState: ExportState = {
  status: 'idle',
  completedSteps: 0,
  totalSteps: 0
}

function getCurrentStep(stage: MigrationStage): number {
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

function isMainMigrationStage(stage: MigrationStage): boolean {
  return stage === 'migration' || stage === 'migration_completed' || stage === 'completed' || stage === 'error'
}

function getExportTaskTranslationKey(task?: string): string | null {
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

const MigrationApp: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { progress, lastError, confirmComplete } = useMigrationProgress()
  const actions = useMigrationActions()
  const [isLoading, setIsLoading] = useState(false)
  const [backupChoice, setBackupChoice] = useState<BackupChoice>('create')
  const [displayStageOverride, setDisplayStageOverride] = useState<MigrationStage | null>(null)
  const [exportState, setExportState] = useState<ExportState>(initialExportState)
  const [localError, setLocalError] = useState<string | null>(null)

  const currentLanguage = i18n.language.toLowerCase().includes('zh') ? 'zh-CN' : 'en-US'
  const displayStage = localError ? 'error' : (displayStageOverride ?? progress.stage)
  const progressMessage = progress.i18nMessage
    ? t(progress.i18nMessage.key, progress.i18nMessage.params)
    : progress.currentMessage
  const currentStep = getCurrentStep(displayStage)

  useEffect(() => {
    if (
      progress.stage === 'introduction' ||
      progress.stage === 'backup_progress' ||
      progress.stage === 'migration' ||
      progress.stage === 'migration_completed' ||
      progress.stage === 'completed' ||
      progress.stage === 'error'
    ) {
      setDisplayStageOverride(null)
    }
  }, [progress.stage])

  useEffect(() => {
    if (progress.backupInfo?.mode && (progress.stage === 'backup_progress' || progress.stage === 'backup_confirmed')) {
      setBackupChoice(progress.backupInfo.mode)
    }
  }, [progress.backupInfo, progress.stage])

  const resetLocalMigrationState = () => {
    setLocalError(null)
    setExportState(initialExportState)
  }

  const handleLanguageChange = async (lang: string) => {
    if (lang === currentLanguage) {
      return
    }

    await i18n.changeLanguage(lang)
  }

  const handleStartMigration = async () => {
    setIsLoading(true)
    setLocalError(null)
    setDisplayStageOverride('migration')
    setExportState({
      status: 'running',
      currentTask: 'redux_state',
      completedSteps: 0,
      totalSteps: 1
    })

    try {
      logger.info('Starting migration process...')

      const userDataPath = await window.electron.ipcRenderer.invoke(MigrationIpcChannels.GetUserDataPath)
      const exportPath = `${userDataPath}/migration_temp/dexie_export`
      const dexieExporter = new DexieExporter(exportPath)
      const tablesToExport = dexieExporter.getTablesToExport()
      const totalExportSteps = tablesToExport.length + 1

      setExportState({
        status: 'running',
        currentTask: 'redux_state',
        completedSteps: 0,
        totalSteps: totalExportSteps
      })

      const reduxExporter = new ReduxExporter()
      const reduxResult = reduxExporter.export()
      logger.info('Redux data exported', {
        slicesFound: reduxResult.slicesFound,
        slicesMissing: reduxResult.slicesMissing
      })

      setExportState({
        status: 'running',
        currentTask: tablesToExport[0],
        completedSteps: 1,
        totalSteps: totalExportSteps
      })

      await dexieExporter.exportAll((exportProgress) => {
        logger.info('Dexie export progress', exportProgress)

        setExportState({
          status: 'running',
          currentTask: exportProgress.table,
          completedSteps: 1 + exportProgress.progress,
          totalSteps: totalExportSteps
        })
      })

      logger.info('Dexie data exported', { exportPath })

      setExportState({
        status: 'completed',
        completedSteps: totalExportSteps,
        totalSteps: totalExportSteps
      })

      await actions.startMigration(reduxResult.data, exportPath)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      logger.error('Failed to start migration', error as Error)
      setLocalError(errorMessage)
      setExportState((prev) => ({
        ...prev,
        status: 'failed'
      }))
      setDisplayStageOverride('error')
    } finally {
      setIsLoading(false)
    }
  }

  const exportTaskLabel = useMemo(() => {
    const translationKey = getExportTaskTranslationKey(exportState.currentTask)
    if (translationKey) {
      return t(translationKey)
    }

    return exportState.currentTask
  }, [exportState.currentTask, t])

  const migrationOperationMessage = useMemo(() => {
    if (displayStage === 'migration_completed') {
      return t('migration.migration_run.summary.done')
    }

    if (displayStage !== 'migration') {
      return progressMessage
    }

    if (!isMainMigrationStage(progress.stage) && exportState.status !== 'idle') {
      if (exportState.status === 'completed') {
        return t('migration.progress.starting_engine')
      }

      if (exportState.status === 'running') {
        return t('migration.progress.exporting_table', {
          table: exportTaskLabel,
          current: Math.min(exportState.completedSteps + 1, exportState.totalSteps),
          total: exportState.totalSteps
        })
      }
    }

    return progressMessage
  }, [displayStage, exportState, exportTaskLabel, progress.stage, progressMessage, t])

  const checklistItems = progress.migrators

  const checklistStats = useMemo(() => {
    const total = checklistItems.length
    const completed = checklistItems.filter((item) => item.status === 'completed').length

    return {
      total,
      completed
    }
  }, [checklistItems])

  const displayedProgress = useMemo(() => {
    if (displayStage === 'migration_completed' || displayStage === 'completed') {
      return 100
    }

    if (displayStage !== 'migration') {
      return Math.round(progress.overallProgress)
    }

    if (isMainMigrationStage(progress.stage)) {
      return EXPORT_PROGRESS_WEIGHT + Math.round((progress.overallProgress / 100) * MIGRATION_PROGRESS_WEIGHT)
    }

    if (exportState.totalSteps === 0) {
      return 0
    }

    return Math.round((exportState.completedSteps / exportState.totalSteps) * EXPORT_PROGRESS_WEIGHT)
  }, [displayStage, exportState.completedSteps, exportState.totalSteps, progress.overallProgress, progress.stage])

  const footerMessage = useMemo(() => {
    switch (displayStage) {
      case 'introduction':
        return t('migration.footer.introduction')
      case 'backup_required':
        return backupChoice === 'create'
          ? t('migration.footer.backup_required_create')
          : t('migration.footer.backup_required_existing')
      case 'backup_progress':
        return t('migration.footer.backup_progress')
      case 'backup_confirmed':
        return t('migration.footer.backup_confirmed')
      case 'migration':
        return migrationOperationMessage
      case 'migration_completed':
        return t('migration.footer.migration_completed')
      case 'completed':
        return t('migration.footer.completed')
      case 'error':
        return t('migration.footer.error')
      default:
        return progressMessage
    }
  }, [backupChoice, displayStage, migrationOperationMessage, progressMessage, t])

  const handleClose = () => actions.cancel()

  const handleRetry = async () => {
    resetLocalMigrationState()
    setDisplayStageOverride(null)
    await actions.retry()
  }

  const handleGoBack = () => {
    switch (displayStage) {
      case 'backup_required':
        setDisplayStageOverride('introduction')
        break
      case 'backup_confirmed':
        setDisplayStageOverride('backup_required')
        break
      default:
        break
    }
  }

  const handleProceedFromOverview = () => {
    resetLocalMigrationState()

    if (progress.stage === 'introduction') {
      setDisplayStageOverride(null)
      return actions.proceedToBackup()
    }

    setDisplayStageOverride('backup_required')
  }

  const handleProceedFromBackup = () => {
    resetLocalMigrationState()
    setDisplayStageOverride(null)

    if (backupChoice === 'create') {
      return actions.showBackupDialog()
    }

    return actions.confirmBackup('existing')
  }

  const errorMessage = localError || lastError || progress.error || t('migration.error.unknown')
  const confirmedBackupMode = progress.backupInfo?.mode ?? backupChoice

  const renderContent = () => {
    switch (displayStage) {
      case 'introduction':
        return (
          <MigrationOverviewStep
            currentLanguage={currentLanguage}
            languageOptions={languageOptions}
            onLanguageChange={handleLanguageChange}
          />
        )
      case 'backup_required':
      case 'backup_progress':
      case 'backup_confirmed':
        return (
          <MigrationBackupStep
            stage={displayStage}
            backupChoice={backupChoice}
            confirmedBackupMode={confirmedBackupMode}
            onBackupChoiceChange={setBackupChoice}
          />
        )
      case 'migration':
        return (
          <MigrationRunStep
            complete={false}
            operationMessage={migrationOperationMessage}
            progressValue={displayedProgress}
            completedCount={checklistStats.completed}
            totalCount={checklistStats.total}
            migrators={checklistItems}
          />
        )
      case 'migration_completed':
        return (
          <MigrationRunStep
            complete
            operationMessage={migrationOperationMessage}
            progressValue={100}
            completedCount={checklistStats.total}
            totalCount={checklistStats.total}
            migrators={checklistItems}
          />
        )
      case 'completed':
        return <MigrationCompletedStep />
      case 'error':
        return <MigrationErrorStep errorMessage={errorMessage} />
      default:
        return (
          <MigrationOverviewStep
            currentLanguage={currentLanguage}
            languageOptions={languageOptions}
            onLanguageChange={handleLanguageChange}
          />
        )
    }
  }

  const renderFooterActions = () => {
    switch (displayStage) {
      case 'introduction':
        return {
          secondary: null,
          primary: (
            <Button key="primary-next" className={footerPrimaryButtonClassName} onClick={handleProceedFromOverview}>
              {t('migration.buttons.next')}
              <ArrowRight className="lucide-custom size-4" />
            </Button>
          )
        }
      case 'backup_required':
        return {
          secondary: (
            <Button
              key="secondary-back"
              variant="ghost"
              className={footerSecondaryButtonClassName}
              onClick={handleGoBack}>
              {t('migration.buttons.back')}
            </Button>
          ),
          primary: (
            <Button key="primary-next" className={footerPrimaryButtonClassName} onClick={handleProceedFromBackup}>
              {t('migration.buttons.next')}
              <ArrowRight className="lucide-custom size-4" />
            </Button>
          )
        }
      case 'backup_progress':
        return {
          secondary: null,
          primary: (
            <Button key="primary-backing-up" className={footerPrimaryButtonClassName} disabled loading>
              {t('migration.buttons.backing_up')}
            </Button>
          )
        }
      case 'backup_confirmed':
        return {
          secondary: (
            <Button
              key="secondary-back"
              variant="ghost"
              className={footerSecondaryButtonClassName}
              onClick={handleGoBack}>
              {t('migration.buttons.back')}
            </Button>
          ),
          primary: (
            <Button
              key="primary-next"
              className={footerPrimaryButtonClassName}
              onClick={handleStartMigration}
              loading={isLoading}>
              {t('migration.buttons.next')}
              <ArrowRight className="lucide-custom size-4" />
            </Button>
          )
        }
      case 'migration':
        return {
          secondary: null,
          primary: (
            <Button key="primary-migrating" className={footerPrimaryButtonClassName} disabled loading>
              {t('migration.buttons.migrating')}
            </Button>
          )
        }
      case 'migration_completed':
        return {
          secondary: null,
          primary: (
            <Button key="primary-next" className={footerPrimaryButtonClassName} onClick={confirmComplete}>
              {t('migration.buttons.next')}
              <ArrowRight className="lucide-custom size-4" />
            </Button>
          )
        }
      case 'completed':
        return {
          secondary: null,
          primary: (
            <Button key="primary-restart" className={footerPrimaryButtonClassName} onClick={actions.restart}>
              {t('migration.buttons.restart')}
              <RefreshCw className="lucide-custom size-4" />
            </Button>
          )
        }
      case 'error':
        return {
          secondary: null,
          primary: (
            <Button key="primary-retry" className={footerPrimaryButtonClassName} onClick={handleRetry}>
              {t('migration.buttons.retry')}
              <RefreshCw className="lucide-custom size-4" />
            </Button>
          )
        }
      default:
        return {
          secondary: null,
          primary: null
        }
    }
  }

  const footerActions = renderFooterActions()

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden text-foreground">
      <MigrationHeader stage={displayStage} onClose={handleClose} />

      <main className="flex flex-1 overflow-auto">
        <div className="mx-auto flex min-h-full w-full max-w-190 flex-col justify-center px-6 py-12">
          <div
            key={displayStage}
            className={cn(
              'fade-in animate-in duration-300',
              displayStage === 'error' && 'slide-in-from-bottom-3',
              displayStage !== 'error' && 'slide-in-from-right-4'
            )}>
            {renderContent()}
          </div>
        </div>
      </main>

      <MigrationFooter
        currentStep={currentStep}
        totalSteps={totalSteps}
        message={footerMessage}
        secondaryAction={footerActions.secondary}
        primaryAction={footerActions.primary}
      />
    </div>
  )
}

export default MigrationApp
