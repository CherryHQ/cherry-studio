import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AppLogo } from '@renderer/config/env'
import { loggerService } from '@renderer/services/LoggerService'
import { MigrationIpcChannels, type MigrationStage } from '@shared/data/migration/v2/types'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  FolderOpen,
  Loader2,
  Rocket,
  RotateCcw,
  Shield,
  Sparkles,
  X
} from 'lucide-react'
import React, { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Confetti, MigratorProgressList, SkipMigrationDialog } from './components'
import { DexieExporter, LocalStorageExporter, ReduxExporter } from './exporters'
import { useMigrationActions, useMigrationProgress } from './hooks/useMigrationProgress'

const logger = loggerService.withContext('MigrationApp')

type BadgeTone = 'primary' | 'success' | 'warning' | 'destructive' | 'neutral'
type BackupDialogResult = { success: boolean; error?: string; canceled?: boolean }

const badgeToneClass: Record<BadgeTone, string> = {
  primary: 'border-primary/15 bg-primary/10 text-primary',
  success: 'border-success/25 bg-success/12 text-success',
  warning: 'border-warning/25 bg-warning/12 text-warning',
  destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
  neutral: 'border-border bg-muted/40 text-foreground-secondary'
}

const StageBadge: React.FC<{ tone?: BadgeTone; children: React.ReactNode }> = ({ tone = 'neutral', children }) => (
  <div
    className={cn(
      'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border [&>svg]:stroke-current [&>svg]:text-current',
      badgeToneClass[tone]
    )}>
    {children}
  </div>
)

const ProgressBar: React.FC<{ value: number }> = ({ value }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
    <div
      className="h-full rounded-full bg-primary transition-[width] duration-300"
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    />
  </div>
)

const RAIL_STEPS = [
  { n: 1, labelKey: 'migration.stages.introduction' },
  { n: 2, labelKey: 'migration.stages.backup' },
  { n: 3, labelKey: 'migration.stages.migration' },
  { n: 4, labelKey: 'migration.stages.completed' }
] as const

function stageStepNumber(stage: MigrationStage): number | null {
  switch (stage) {
    case 'introduction':
      return 1
    case 'backup_required':
    case 'backup_progress':
    case 'backup_confirmed':
      return 2
    case 'migration':
    case 'error':
      return 3
    case 'completed':
      return 4
    case 'version_incompatible':
      return null
    default:
      return 1
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const StepRail: React.FC<{ stage: MigrationStage }> = ({ stage }) => {
  const { t, i18n } = useTranslation()
  const current = stageStepNumber(stage)

  const handleLanguageChange = (lang: string) => {
    void i18n.changeLanguage(lang)
  }

  return (
    <aside className="flex w-44 shrink-0 flex-col border-border border-r bg-muted/20">
      <ol className="flex flex-1 flex-col p-6">
        {RAIL_STEPS.map((step, index) => {
          const isError = stage === 'error' && step.n === current
          const done = current !== null && step.n < current
          const active = step.n === current
          const isLast = index === RAIL_STEPS.length - 1

          return (
            <li key={step.n} className="relative flex h-11 w-fit items-center gap-3">
              {!isLast && (
                <span
                  className={cn(
                    '-translate-x-1/2 absolute top-1/2 left-3 h-11 w-px',
                    done ? 'bg-primary/40' : 'bg-border'
                  )}
                />
              )}
              <div
                className={cn(
                  'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-medium text-sm',
                  isError && 'bg-destructive text-destructive-foreground',
                  !isError && active && 'bg-primary text-white',
                  !isError && done && 'bg-primary text-white',
                  !isError && !active && !done && 'border border-border bg-background text-foreground-muted'
                )}>
                {isError ? (
                  <X size={13} strokeWidth={2.5} />
                ) : done ? (
                  <Check size={12} strokeWidth={3} className="lucide-custom text-white" />
                ) : (
                  step.n
                )}
              </div>
              <span
                className={cn(
                  'relative z-10 truncate text-sm',
                  active && 'font-medium text-foreground',
                  done && 'text-foreground-secondary',
                  !active && !done && 'text-foreground-muted'
                )}>
                {t(step.labelKey)}
              </span>
            </li>
          )
        })}
      </ol>
      <div className="p-3">
        <Select value={i18n.language} onValueChange={handleLanguageChange}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-CN">中文</SelectItem>
            <SelectItem value="en-US">English</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </aside>
  )
}

const BackupChoiceRow: React.FC<{
  selected: boolean
  onSelect: () => void
  icon: React.ReactNode
  title: string
  description: string
  badge?: React.ReactNode
}> = ({ selected, onSelect, icon, title, description, badge }) => (
  <button
    type="button"
    onClick={onSelect}
    className={cn(
      'flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
      selected ? 'border-border-active bg-accent' : 'border-border bg-muted/10 hover:bg-muted/20'
    )}>
    <span className={cn('mt-0.5 shrink-0', selected ? 'text-foreground' : 'text-foreground-muted')}>{icon}</span>
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate font-medium text-foreground text-sm">{title}</p>
        {badge}
      </div>
      <p className="mt-1 text-foreground-muted text-xs leading-relaxed">{description}</p>
    </div>
    <span
      className={cn(
        'mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full',
        selected ? 'bg-foreground text-background' : 'border border-border'
      )}>
      {selected && <Check size={11} strokeWidth={2.75} className="lucide-custom text-background" />}
    </span>
  </button>
)

const Stat: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col items-center justify-center gap-1 px-2 text-center">{children}</div>
)

// Centered top content (icon, title, description), capped to a fixed reading
// width. Lower content stays a full-width sibling outside this wrapper.
const TopContent: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mx-auto max-w-115 text-center">{children}</div>
)

const MigrationApp: React.FC = () => {
  const { t } = useTranslation()
  const { progress, lastError, returnToIntroduction } = useMigrationProgress()
  const actions = useMigrationActions()
  const [isLoading, setIsLoading] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupChoice, setBackupChoice] = useState<'create' | 'existing'>('create')
  const [backupError, setBackupError] = useState<string | null>(null)
  const [skipOpen, setSkipOpen] = useState(false)
  const startGuardRef = useRef(false)

  // Create-backup path: enter a loading/disabled state immediately on click and
  // hold it until main returns (success → backup_confirmed, cancel → backup_required).
  const handleCreateBackup = async () => {
    if (backupLoading) {
      return
    }
    setBackupError(null)
    setBackupLoading(true)
    try {
      const result = (await actions.showBackupDialog()) as BackupDialogResult | undefined
      if (result && !result.success && !result.canceled && result.error) {
        setBackupError(result.error)
      }
    } catch (error) {
      setBackupError(errorMessage(error))
    } finally {
      setBackupLoading(false)
    }
  }

  const runMigration = async () => {
    if (startGuardRef.current) {
      return
    }

    startGuardRef.current = true
    setIsLoading(true)
    try {
      logger.info('Starting migration process...')

      // Export Redux data
      const reduxExporter = new ReduxExporter()
      const reduxResult = reduxExporter.export()
      logger.info('Redux data exported', {
        slicesFound: reduxResult.slicesFound,
        slicesMissing: reduxResult.slicesMissing
      })

      // Export Dexie data
      const userDataPath = await window.electron.ipcRenderer.invoke(MigrationIpcChannels.GetUserDataPath)
      const exportBasePath = `${userDataPath}/migration_temp`
      const dexieExportPath = `${exportBasePath}/dexie_export`
      const dexieExporter = new DexieExporter(dexieExportPath)

      await dexieExporter.exportAll((p) => {
        logger.info('Dexie export progress', p)
      })

      logger.info('Dexie data exported', { exportPath: dexieExportPath })

      // Export localStorage data
      const localStorageExportPath = `${exportBasePath}/localstorage_export`
      const localStorageExporter = new LocalStorageExporter(localStorageExportPath)
      const localStorageFilePath = await localStorageExporter.export()
      logger.info('localStorage data exported', {
        entryCount: localStorageExporter.getEntryCount(),
        filePath: localStorageFilePath
      })

      // Start migration with exported data
      await actions.startMigration({
        reduxData: reduxResult.data,
        dexieExportPath,
        localStorageExportPath: localStorageFilePath
      })
    } catch (error) {
      logger.error('Failed to start migration', error as Error)
    } finally {
      startGuardRef.current = false
      setIsLoading(false)
    }
  }

  const handleStartMigration = async () => {
    if (progress.stage !== 'backup_confirmed') {
      return
    }

    await runMigration()
  }

  const progressMessage = useMemo(() => {
    if (progress.i18nMessage) {
      return t(progress.i18nMessage.key, progress.i18nMessage.params)
    }
    return progress.currentMessage
  }, [progress, t])

  const showRail = progress.stage !== 'version_incompatible'

  const renderStage = () => {
    switch (progress.stage) {
      case 'introduction':
        return (
          <div className="space-y-6">
            <TopContent>
              <StageBadge tone="neutral">
                <Rocket size={28} strokeWidth={1.5} />
              </StageBadge>
              <h1 className="font-semibold text-2xl text-foreground tracking-tight">
                {t('migration.introduction.title')}
              </h1>
              <p className="mt-2 text-foreground-muted text-sm">{t('migration.introduction.subtitle')}</p>
            </TopContent>

            <div className="space-y-2.5">
              {[
                {
                  icon: <Sparkles size={16} />,
                  title: t('migration.introduction.features.architecture.title'),
                  description: t('migration.introduction.features.architecture.description')
                },
                {
                  icon: <Database size={16} />,
                  title: t('migration.introduction.features.migration.title'),
                  description: t('migration.introduction.features.migration.description')
                },
                {
                  icon: <Shield size={16} />,
                  title: t('migration.introduction.features.safety.title'),
                  description: t('migration.introduction.features.safety.description')
                }
              ].map((feature, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 rounded-xl border border-border bg-muted/15 px-4 py-3.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40 text-foreground-secondary">
                    {feature.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground text-sm">{feature.title}</p>
                    <p className="mt-0.5 text-foreground-muted text-xs leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2.5">
              <Button variant="default" size="lg" className="w-full gap-2" onClick={() => actions.proceedToBackup()}>
                {t('migration.buttons.next')}
                <ArrowRight size={14} />
              </Button>
              <button
                type="button"
                onClick={() => setSkipOpen(true)}
                className="mx-auto block text-foreground-muted text-xs transition-colors hover:text-foreground">
                {t('migration.buttons.skip_migration')}
              </button>
            </div>
          </div>
        )

      case 'backup_required':
        return (
          <div className="space-y-5">
            <TopContent>
              <StageBadge tone="neutral">
                <Shield size={26} strokeWidth={1.5} />
              </StageBadge>
              <h2 className="font-semibold text-foreground text-lg tracking-tight">
                {t('migration.backup_required.title')}
              </h2>
              <p className="mt-1.5 text-foreground-muted text-sm leading-relaxed">
                {t('migration.backup_required.description')}
              </p>
            </TopContent>

            <div className="space-y-2">
              <BackupChoiceRow
                selected={backupChoice === 'create'}
                onSelect={() => {
                  setBackupChoice('create')
                  setBackupError(null)
                }}
                icon={<Database size={16} />}
                title={t('migration.buttons.create_backup')}
                description={t('migration.backup_required.create_desc')}
                badge={
                  <Badge className="border-blue-500/30 bg-blue-500/10 px-2 py-0 font-medium text-blue-600 dark:text-blue-400">
                    {t('migration.backup_required.recommended')}
                  </Badge>
                }
              />
              <BackupChoiceRow
                selected={backupChoice === 'existing'}
                onSelect={() => {
                  setBackupChoice('existing')
                  setBackupError(null)
                }}
                icon={<Shield size={16} />}
                title={t('migration.buttons.already_backed_up')}
                description={t('migration.backup_required.existing_desc')}
              />
            </div>

            {backupError && (
              <Alert type="error" showIcon message={t('migration.backup_required.failure', { reason: backupError })} />
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="lg"
                className="gap-1.5"
                disabled={backupLoading}
                onClick={() => {
                  setBackupError(null)
                  returnToIntroduction()
                }}>
                <ArrowLeft size={13} />
                {t('migration.buttons.back')}
              </Button>
              <Button
                variant="default"
                size="lg"
                className="flex-1 gap-2"
                disabled={backupLoading}
                loading={backupChoice === 'create' && backupLoading ? true : undefined}
                onClick={() => {
                  if (backupChoice === 'create') {
                    void handleCreateBackup()
                  } else {
                    void actions.confirmBackup()
                  }
                }}>
                {backupChoice === 'create' ? <Database size={14} /> : <ArrowRight size={14} />}
                {backupChoice === 'create'
                  ? t('migration.buttons.create_backup')
                  : t('migration.buttons.confirm_and_continue')}
              </Button>
            </div>
          </div>
        )

      case 'backup_progress':
        return (
          <div className="space-y-5">
            <TopContent>
              <StageBadge tone="neutral">
                <Loader2 size={26} strokeWidth={1.5} className="animate-spin" />
              </StageBadge>
              <h2 className="font-medium text-foreground text-lg">{t('migration.backup_progress.title')}</h2>
              <p className="mt-1.5 text-foreground-muted text-sm">{t('migration.backup_progress.description')}</p>
            </TopContent>
            <ProgressBar value={progress.overallProgress} />
          </div>
        )

      case 'backup_confirmed': {
        const hasCreatedBackup = Boolean(progress.backupInfo?.createdBackupPath)
        return (
          <div className="space-y-5">
            <TopContent>
              <StageBadge tone={hasCreatedBackup ? 'success' : 'neutral'}>
                {hasCreatedBackup ? (
                  <CheckCircle2 size={26} strokeWidth={1.5} />
                ) : (
                  <Shield size={26} strokeWidth={1.5} />
                )}
              </StageBadge>
              <h2 className="font-semibold text-foreground text-lg tracking-tight">
                {t(
                  hasCreatedBackup
                    ? 'migration.backup_confirmed.created_title'
                    : 'migration.backup_confirmed.existing_title'
                )}
              </h2>
              <p className="mt-1.5 text-foreground-muted text-sm leading-relaxed">
                {t(
                  hasCreatedBackup
                    ? 'migration.backup_confirmed.created_description'
                    : 'migration.backup_confirmed.existing_description'
                )}
              </p>
            </TopContent>
            <Button
              variant="default"
              size="lg"
              className="w-full gap-2"
              loading={isLoading ? true : undefined}
              onClick={handleStartMigration}>
              <ArrowRight size={14} />
              {t('migration.buttons.start_migration')}
            </Button>
          </div>
        )
      }

      case 'migration':
        return (
          <div className="space-y-4">
            <TopContent>
              <StageBadge tone="primary">
                <Loader2 size={26} strokeWidth={1.5} className="animate-spin" />
              </StageBadge>
              <h2 className="font-semibold text-foreground text-lg tracking-tight">{t('migration.migration.title')}</h2>
              <p className="mt-1.5 text-foreground-muted text-sm">{progressMessage}</p>
            </TopContent>
            <div>
              <div className="mb-2 flex items-center justify-between text-foreground-muted text-xs">
                <span className="tabular-nums">{Math.round(progress.overallProgress)}%</span>
              </div>
              <ProgressBar value={progress.overallProgress} />
            </div>
            <MigratorProgressList migrators={progress.migrators} overallProgress={progress.overallProgress} />
            <p className="pt-0.5 text-center text-foreground-muted text-xs">{t('migration.migration.do_not_close')}</p>
          </div>
        )

      case 'completed': {
        const summary = progress.summary
        const backupPath = progress.backupInfo?.createdBackupPath
        const warnings = progress.warnings ?? []
        return (
          <div className="space-y-5">
            <TopContent>
              <div className="relative mx-auto mb-4 inline-block text-[56px] leading-none">
                🎉
                <Confetti />
              </div>
              <h2 className="font-semibold text-2xl text-foreground tracking-tight">
                {t('migration.completed.title')}
              </h2>
              <p className="mt-2.5 text-foreground-muted text-sm leading-relaxed">
                {t('migration.completed.description')}
              </p>
            </TopContent>

            {summary && (
              <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-muted/10 py-4">
                <Stat>
                  <span className="font-semibold text-2xl text-foreground tabular-nums">
                    {summary.completedMigrators}/{summary.totalMigrators}
                  </span>
                  <span className="text-foreground-muted text-xs">{t('migration.completed.steps_label')}</span>
                </Stat>
                <Stat>
                  <span className="font-semibold text-2xl text-foreground tabular-nums">{summary.itemsProcessed}</span>
                  <span className="text-foreground-muted text-xs">{t('migration.completed.items_label')}</span>
                </Stat>
                <Stat>
                  <span className="font-semibold text-2xl text-foreground tabular-nums">
                    {formatDuration(summary.durationMs)}
                  </span>
                  <span className="text-foreground-muted text-xs">{t('migration.completed.duration_label')}</span>
                </Stat>
              </div>
            )}

            {backupPath && (
              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/10 px-4 py-2.5">
                <FolderOpen size={13} className="mt-0.5 shrink-0 text-foreground-muted" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground-muted text-xs">{t('migration.completed.backup_heading')}</p>
                  <p className="mt-0.5 break-all font-mono text-foreground-secondary text-xs">{backupPath}</p>
                </div>
              </div>
            )}

            <Button variant="default" size="lg" className="w-full gap-2" onClick={() => actions.restart()}>
              <RotateCcw size={14} />
              {t('migration.buttons.restart')}
            </Button>

            {warnings.length > 0 && (
              <Accordion type="single" collapsible className="rounded-xl border border-warning/30 bg-warning/10 px-4">
                <AccordionItem value="migration-warnings" className="border-0 first:border-t-0">
                  <AccordionTrigger className="py-3 font-medium text-sm text-warning hover:no-underline">
                    {t('migration.completed.warning_heading', { count: warnings.length })}
                  </AccordionTrigger>
                  <AccordionContent className="pt-0 pb-3" contentClassName="text-foreground-secondary">
                    <p className="text-xs leading-relaxed">{t('migration.completed.warning_description')}</p>
                    <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs leading-relaxed">
                      {warnings.map((warning, index) => (
                        <li key={index} className="wrap-break-words">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        )
      }

      case 'error':
        return (
          <div className="space-y-5">
            <TopContent>
              <StageBadge tone="destructive">
                <AlertTriangle size={26} strokeWidth={1.5} />
              </StageBadge>
              <h2 className="font-semibold text-foreground text-lg tracking-tight">{t('migration.error.title')}</h2>
              <p className="mt-1.5 text-foreground-muted text-sm leading-relaxed">{t('migration.error.description')}</p>
            </TopContent>
            <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3">
              <p className="wrap-break-words text-destructive text-xs leading-relaxed">
                {t('migration.error.error_prefix')}
                {lastError || progress.error || 'Unknown error'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="lg" onClick={() => actions.cancel()}>
                {t('migration.buttons.close')}
              </Button>
              <Button variant="default" size="lg" className="flex-1 gap-2" onClick={() => actions.retry()}>
                <RotateCcw size={14} />
                {t('migration.buttons.retry')}
              </Button>
            </div>
          </div>
        )

      case 'version_incompatible':
        return (
          <div className="mx-auto w-full max-w-115 space-y-4">
            <div className="text-center">
              <StageBadge tone="warning">
                <AlertTriangle size={26} strokeWidth={1.5} />
              </StageBadge>
              <h2 className="font-semibold text-foreground text-lg tracking-tight">
                {t('migration.version_incompatible.title')}
              </h2>
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-muted/10 px-4 py-3 text-foreground-secondary text-sm leading-relaxed">
              <p>{t('migration.version_incompatible.preamble')}</p>
              <p>{progressMessage}</p>
              <p>{t('migration.version_incompatible.ignore_hint')}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="lg" onClick={() => actions.cancel()}>
                {t('migration.buttons.close')}
              </Button>
              <Button variant="destructive" size="lg" className="flex-1" onClick={() => setSkipOpen(true)}>
                {t('migration.buttons.ignore_migration')}
              </Button>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-card text-card-foreground">
      <header className="relative flex h-11 shrink-0 items-center justify-center border-border border-b [-webkit-app-region:drag]">
        <div className="flex items-center gap-2">
          <img src={AppLogo} alt="Cherry Studio" className="h-4.5 w-4.5 rounded-md object-cover" />
          <span className="font-medium text-foreground text-sm">Cherry Studio</span>
          <span className="text-foreground-muted">·</span>
          <span className="text-foreground-muted text-xs">{t('migration.title')}</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {showRail && <StepRail stage={progress.stage} />}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full w-full flex-col justify-center px-16 py-8">{renderStage()}</div>
        </main>
      </div>

      <SkipMigrationDialog open={skipOpen} onOpenChange={setSkipOpen} onConfirm={() => actions.skipMigration()} />
    </div>
  )
}

export default MigrationApp
