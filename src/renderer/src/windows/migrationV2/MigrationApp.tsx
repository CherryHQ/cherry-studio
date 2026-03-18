import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@renderer/services/LoggerService'
import { type MigrationBackupMode, MigrationIpcChannels, type MigrationStage } from '@shared/data/migration/v2/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { MigrationHeader } from './components'
import { DexieExporter, LocalStorageExporter, ReduxExporter } from './exporters'
import { useMigrationActions, useMigrationProgress, useMigrationViewState } from './hooks'
import {
  createDexieExportStartState,
  createInitialExportState,
  EXPORT_PROGRESS_WEIGHT,
  getExportTaskTranslationKey,
  getNextDexieExportState,
  isCloseAllowed,
  MIGRATION_PROGRESS_WEIGHT
} from './progress'
import { BackupScreen, CompletionScreen, FailedScreen, IntroductionScreen, MigrationScreen } from './screens'
const logger = loggerService.withContext('MigrationApp')

const LANGUAGE_OPTIONS = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en-US', label: 'English' }
]

export default function MigrationApp() {
  const { t, i18n } = useTranslation()
  const { progress, lastError } = useMigrationProgress()
  const actions = useMigrationActions()
  const {
    state: viewState,
    selectBackupChoice,
    resetTransientState,
    startMigrationRequest,
    setExportState,
    failStartMigration,
    finishStartMigration
  } = useMigrationViewState(progress.stage, progress.backupInfo?.mode)
  const { backupChoice, exportState, localError, startMigrationState } = viewState

  const currentLanguage = i18n.language.toLowerCase().includes('zh') ? 'zh-CN' : 'en-US'
  const isStartingMigration = startMigrationState === 'pending'
  const displayStage: MigrationStage = progress.stage === 'failed' || !localError ? progress.stage : 'failed'
  const progressMessage = progress.i18nMessage
    ? t(progress.i18nMessage.key, progress.i18nMessage.params)
    : progress.currentMessage

  const handleLanguageChange = async (lang: string) => {
    if (lang === currentLanguage) {
      return
    }

    await i18n.changeLanguage(lang)
  }

  const handleStartMigration = async () => {
    startMigrationRequest()

    try {
      await actions.prepareMigration()

      logger.info('Starting migration process...')

      const userDataPath = await window.electron.ipcRenderer.invoke(MigrationIpcChannels.GetUserDataPath)
      const exportPath = `${userDataPath}/migration_temp/dexie_export`
      const dexieExporter = new DexieExporter(exportPath)
      const tablesToExport = dexieExporter.getTablesToExport()
      const totalExportSteps = tablesToExport.length + 1

      setExportState(createInitialExportState(totalExportSteps))

      const reduxExporter = new ReduxExporter()
      const reduxResult = reduxExporter.export()
      logger.info('Redux data exported', {
        slicesFound: reduxResult.slicesFound,
        slicesMissing: reduxResult.slicesMissing
      })

      setExportState(createDexieExportStartState(tablesToExport[0], totalExportSteps))

      await dexieExporter.exportAll((exportProgress) => {
        logger.info('Dexie export progress', exportProgress)

        setExportState(getNextDexieExportState(exportProgress, tablesToExport, totalExportSteps))
      })

      logger.info('Dexie data exported', { exportPath })

      const localStorageExportPath = `${userDataPath}/migration_temp/localstorage_export`
      const localStorageExporter = new LocalStorageExporter(localStorageExportPath)
      const localStorageFilePath = await localStorageExporter.export()
      logger.info('localStorage data exported', {
        entryCount: localStorageExporter.getEntryCount(),
        filePath: localStorageFilePath
      })

      setExportState({
        status: 'completed',
        completedSteps: totalExportSteps,
        totalSteps: totalExportSteps,
        activeStep: totalExportSteps
      })

      await actions.startMigration(reduxResult.data, exportPath, localStorageFilePath)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      logger.error('Failed to start migration', error as Error)
      failStartMigration(errorMessage)

      try {
        await actions.reportFailure(errorMessage)
      } catch (reportError) {
        logger.error('Failed to report migration preparation failure', reportError as Error)
      }
    } finally {
      finishStartMigration()
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
    if (displayStage === 'migration_succeeded') {
      return t('migration.migration_run.summary.done')
    }

    if (displayStage === 'preparing_migration') {
      if (exportState.status === 'completed') {
        return t('migration.progress.starting_engine')
      }

      if (exportState.status === 'running') {
        return t('migration.progress.exporting_table', {
          table: exportTaskLabel,
          current: Math.min(exportState.activeStep, exportState.totalSteps),
          total: exportState.totalSteps
        })
      }
    }

    return progressMessage
  }, [displayStage, exportState, exportTaskLabel, progressMessage, t])

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
    if (displayStage === 'migration_succeeded' || displayStage === 'restart_required') {
      return 100
    }

    if (displayStage === 'migration_in_progress') {
      return EXPORT_PROGRESS_WEIGHT + Math.round((progress.overallProgress / 100) * MIGRATION_PROGRESS_WEIGHT)
    }

    if (displayStage === 'preparing_migration') {
      if (exportState.totalSteps === 0) {
        return 0
      }

      return Math.round((exportState.completedSteps / exportState.totalSteps) * EXPORT_PROGRESS_WEIGHT)
    }

    return Math.round(progress.overallProgress)
  }, [displayStage, exportState.completedSteps, exportState.totalSteps, progress.overallProgress])

  const handleClose = () => actions.cancel()

  const handleRetry = async () => {
    resetTransientState()
    await actions.retry()
  }

  const handleGoBack = () => {
    resetTransientState()
    actions.goBack()
  }

  const handleProceedFromOverview = () => {
    resetTransientState()
    actions.proceedToBackup()
  }

  const handleProceedFromBackup = () => {
    resetTransientState()

    if (backupChoice === 'create') {
      actions.showBackupDialog()
      return
    }

    actions.confirmBackup('existing')
  }

  const errorMessage = localError || lastError || progress.error || t('migration.failed.unknown')
  const confirmedBackupMode: MigrationBackupMode = progress.backupInfo?.mode ?? backupChoice

  const canClose = isCloseAllowed(displayStage)

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden text-foreground">
      <MigrationHeader stage={displayStage} canClose={canClose} onClose={handleClose} />

      <div className="flex flex-1 overflow-hidden">
        <div
          key={displayStage}
          className={cn(
            'flex flex-1 flex-col overflow-hidden fade-in animate-in duration-300',
            displayStage === 'failed' && 'slide-in-from-bottom-3',
            displayStage !== 'failed' && 'slide-in-from-right-4'
          )}>
          {displayStage === 'introduction' && (
            <IntroductionScreen
              currentLanguage={currentLanguage}
              languageOptions={LANGUAGE_OPTIONS}
              onLanguageChange={handleLanguageChange}
              onNext={handleProceedFromOverview}
            />
          )}
          {(displayStage === 'backup_required' ||
            displayStage === 'backup_in_progress' ||
            displayStage === 'backup_ready') && (
            <BackupScreen
              stage={displayStage}
              backupChoice={backupChoice}
              confirmedBackupMode={confirmedBackupMode}
              isStartingMigration={isStartingMigration}
              onBackupChoiceChange={selectBackupChoice}
              onBack={handleGoBack}
              onProceed={handleProceedFromBackup}
              onStartMigration={handleStartMigration}
            />
          )}
          {(displayStage === 'preparing_migration' || displayStage === 'migration_in_progress') && (
            <MigrationScreen
              operationMessage={migrationOperationMessage}
              progressValue={displayedProgress}
              completedCount={checklistStats.completed}
              totalCount={checklistStats.total}
              migrators={checklistItems}
            />
          )}
          {(displayStage === 'migration_succeeded' || displayStage === 'restart_required') && (
            <CompletionScreen
              stage={displayStage}
              operationMessage={migrationOperationMessage}
              totalCount={checklistStats.total}
              migrators={checklistItems}
              onConfirm={actions.confirmMigrationResult}
              onRestart={actions.restart}
            />
          )}
          {displayStage === 'failed' && <FailedScreen errorMessage={errorMessage} onRetry={() => void handleRetry()} />}
        </div>
      </div>
    </div>
  )
}
