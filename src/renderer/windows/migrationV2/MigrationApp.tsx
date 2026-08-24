import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  error as showErrorToast,
  Scrollbar,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  success as showSuccessToast,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import AppLogo from '@renderer/assets/images/logo.png'
import ToastHost from '@renderer/components/ToastHost'
import { loggerService } from '@renderer/services/LoggerService'
import { isMac } from '@renderer/utils/platform'
import {
  MigrationIpcChannels,
  type MigrationStage,
  type PreparedMigrationExportPaths
} from '@shared/data/migration/v2/types'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Database,
  Download,
  FolderOpen,
  History,
  Loader2,
  Monitor,
  Moon,
  Rocket,
  RotateCcw,
  Shield,
  Sparkles,
  Sun,
  Wrench,
  X
} from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CloseMigrationDialog,
  Confetti,
  MigrationDiagnosticPanel,
  MigrationWindowControls,
  MigratorProgressList,
  SkipMigrationDialog,
  V1DownloadDialog
} from './components'
import { DexieExporter, LocalStorageExporter, ReduxExporter } from './exporters'
import { useMigrationActions, useMigrationProgress } from './hooks/useMigrationProgress'

const logger = loggerService.withContext('MigrationApp')

type BadgeTone = 'primary' | 'success' | 'warning' | 'destructive' | 'neutral'

const badgeToneClass: Record<BadgeTone, string> = {
  primary: 'border-primary/20 bg-primary/10 text-primary',
  success: 'border-success-border bg-success-subtle text-success-subtle-foreground',
  warning: 'border-warning-border bg-warning-subtle text-warning-subtle-foreground',
  destructive: 'border-error-border bg-error-subtle text-error-subtle-foreground',
  neutral: 'border-border bg-muted/40 text-muted-foreground'
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
  <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
    <div
      className="h-full rounded-full bg-primary transition-[width] duration-300"
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    />
  </div>
)

const RAIL_STEPS = [
  { n: 1, labelKey: 'migration.stages.introduction' },
  { n: 2, labelKey: 'migration.stages.migration' },
  { n: 3, labelKey: 'migration.stages.completed' }
] as const

function stageStepNumber(stage: MigrationStage): number | null {
  switch (stage) {
    case 'introduction':
      return 1
    case 'migration':
    case 'error':
      return 2
    case 'completed':
      return 3
    case 'version_incompatible':
      return null
    default:
      return assertNever(stage)
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

// Makes MigrationStage switches exhaustive.
function assertNever(value: never): never {
  throw new Error(`Unhandled migration stage: ${String(value)}`)
}

const StepRail: React.FC<{ stage: MigrationStage }> = ({ stage }) => {
  const { t } = useTranslation()
  const current = stageStepNumber(stage)

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
                  isError && 'border border-error-border bg-error-subtle text-error-subtle-foreground',
                  !isError && (active || done) && 'bg-primary text-primary-foreground',
                  !isError && !active && !done && 'border border-border bg-background text-foreground-disabled'
                )}>
                {isError ? (
                  <X size={13} strokeWidth={2.5} className="lucide-custom" />
                ) : done ? (
                  <Check size={12} strokeWidth={3} className="lucide-custom" />
                ) : (
                  step.n
                )}
              </div>
              <span
                className={cn(
                  'relative z-10 truncate text-sm',
                  active && 'font-medium text-foreground',
                  done && 'text-muted-foreground',
                  !active && !done && 'text-foreground-disabled'
                )}>
                {t(step.labelKey)}
              </span>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}

const Stat: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col items-center justify-center gap-1 px-2 text-center">{children}</div>
)

// Centered top content (icon, title, description), capped to a fixed reading
// width. Lower content stays a full-width sibling outside this wrapper.
const TopContent: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mx-auto max-w-115 text-center">{children}</div>
)

type MigrationOptionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSkipMigration: () => void
  onContinueV1?: () => void
  onCloseApp?: () => void
  onExportDiagnostics?: () => void
  disabled?: boolean
  showLabel?: boolean
}

const MigrationOptionsDialog: React.FC<MigrationOptionsDialogProps> = ({
  open,
  onOpenChange,
  onSkipMigration,
  onContinueV1,
  onCloseApp,
  onExportDiagnostics,
  disabled,
  showLabel = false
}) => {
  const { t } = useTranslation()
  const nextDialogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (nextDialogTimerRef.current) clearTimeout(nextDialogTimerRef.current)
    },
    []
  )

  const transitionTo = (openNextDialog: (() => void) | undefined) => {
    onOpenChange(false)
    if (!openNextDialog) return

    if (nextDialogTimerRef.current) clearTimeout(nextDialogTimerRef.current)
    nextDialogTimerRef.current = setTimeout(() => {
      nextDialogTimerRef.current = null
      openNextDialog()
    }, DIALOG_UNMOUNT_DELAY_MS)
  }

  const handleSkipMigration = () => {
    transitionTo(onSkipMigration)
  }

  const handleContinueV1 = () => {
    transitionTo(onContinueV1)
  }

  const handleExportDiagnostics = () => {
    transitionTo(onExportDiagnostics)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={showLabel ? 'outline' : 'ghost'}
          size={showLabel ? 'lg' : 'icon-sm'}
          disabled={disabled}
          aria-label={t('migration.buttons.more_options')}
          className={cn(
            'text-muted-foreground hover:text-foreground',
            showLabel && 'w-full gap-2',
            disabled && 'text-foreground-disabled hover:text-foreground-disabled'
          )}>
          <Wrench size={15} />
          {showLabel && t('migration.buttons.more_options')}
        </Button>
      </DialogTrigger>
      <DialogContent size={showLabel ? 'default' : 'sm'} className="max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('migration.buttons.more_options')}</DialogTitle>
          <DialogDescription>{t('migration.more_options.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5">
          {onExportDiagnostics && (
            <Button
              type="button"
              variant="outline"
              aria-label={t('migration.more_options.diagnostics_title')}
              className="h-auto w-full items-start justify-start gap-3 whitespace-normal p-4 text-left"
              onClick={handleExportDiagnostics}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                <Download size={16} />
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-foreground text-sm">
                  {t('migration.more_options.diagnostics_title')}
                </span>
                <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">
                  {t('migration.more_options.diagnostics_description')}
                </span>
              </span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            aria-label={t('migration.more_options.use_v2_title')}
            className="h-auto w-full items-start justify-start gap-3 whitespace-normal p-4 text-left"
            onClick={handleSkipMigration}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
              <AlertTriangle size={16} />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-foreground text-sm">
                {t('migration.more_options.use_v2_title')}
              </span>
              <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">
                {t('migration.more_options.skip_description')}
              </span>
            </span>
          </Button>
          {onContinueV1 && (
            <Button
              type="button"
              variant="outline"
              aria-label={t('migration.buttons.continue_v1')}
              className="h-auto w-full items-start justify-start gap-3 whitespace-normal p-4 text-left"
              onClick={handleContinueV1}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                <History size={16} />
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-foreground text-sm">{t('migration.buttons.continue_v1')}</span>
                <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">
                  {t('migration.more_options.continue_v1_description')}
                </span>
              </span>
            </Button>
          )}
        </div>
        <DialogFooter className="items-center sm:justify-between">
          {onCloseApp && (
            <Button type="button" variant="outline" onClick={onCloseApp}>
              {t('migration.buttons.close')}
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="outline">{t('migration.skip_dialog.cancel')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const THEME_STORAGE_KEY = 'migration:theme_mode'
const themeLabelKey: Record<string, string> = {
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
  system: 'settings.theme.system'
}

const MigrationApp: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { progress, lastError } = useMigrationProgress()
  const actions = useMigrationActions()
  const [isLoading, setIsLoading] = useState(false)
  // Some runMigration failures happen before progress can reliably move to error.
  const [localMigrationError, setLocalMigrationError] = useState<string | null>(null)
  const [v1DialogOpen, setV1DialogOpen] = useState(false)
  const [skipOpen, setSkipOpen] = useState(false)
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false)
  const [diagnosticExportOpen, setDiagnosticExportOpen] = useState(false)
  const [diagnosticResult, setDiagnosticResult] = useState<'included' | 'not_included' | null>(null)
  const [warningsDialogOpen, setWarningsDialogOpen] = useState(false)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  // Set when the user confirmed quit but main deferred it because a migration write
  // is still in flight; drives the non-blocking "closing after the current step" notice.
  const [quitDeferred, setQuitDeferred] = useState(false)
  const startGuardRef = useRef(false)
  const diagnosticResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (diagnosticResultTimerRef.current) clearTimeout(diagnosticResultTimerRef.current)
    },
    []
  )

  const [themeMode, setThemeMode] = useState<string>(() => localStorage.getItem(THEME_STORAGE_KEY) ?? 'system')
  const toggleTheme = () => {
    const next = themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light'
    setThemeMode(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
  }
  useEffect(() => {
    // Mirror ThemeProvider: class both <html> (drives Tailwind/@cherrystudio/ui `.dark` tokens)
    // and <body> so global styles keyed off `body.light` — notably scrollbar.css — also resolve
    // in this standalone preboot window.
    const applyResolved = (resolved: 'light' | 'dark') => {
      for (const el of [document.documentElement, document.body]) {
        el.classList.remove('light', 'dark')
        el.classList.add(resolved)
      }
    }

    if (themeMode === 'light' || themeMode === 'dark') {
      applyResolved(themeMode)
      return
    }

    // system: follow the live OS appearance (mirrors ThemeProvider's system branch) so toggling
    // OS light/dark while on "system" updates the window instead of sticking at the mount value.
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyResolved(media.matches ? 'dark' : 'light')
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [themeMode])
  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor

  // Main intercepts an in-flow-stage close (native traffic light / Cmd+Q / custom button) and
  // asks the renderer to show its in-app confirmation dialog here, so the prominent styling
  // and copy are owned by the renderer's design system.
  useEffect(() => {
    const handleConfirmClose = () => setCloseConfirmOpen(true)
    const cleanup = window.electron.ipcRenderer.on(MigrationIpcChannels.ConfirmClose, handleConfirmClose)
    return () => {
      cleanup()
    }
  }, [])

  // Main-driven non-error progress clears the renderer-local error latch.
  useEffect(() => {
    if (progress.stage !== 'error') {
      setLocalMigrationError(null)
    }
  }, [progress.stage])

  // Runs the renderer-side exporters then hands off to main's StartMigration. Only ever
  // invoked from the introduction Start button, so it carries no stage guard.
  const runMigration = async () => {
    if (startGuardRef.current) {
      return
    }

    startGuardRef.current = true
    setIsLoading(true)
    setLocalMigrationError(null)
    try {
      logger.info('Starting migration process...')

      const exportPaths = (await window.electron.ipcRenderer.invoke(
        MigrationIpcChannels.PrepareExport
      )) as PreparedMigrationExportPaths

      // Export Redux slices to disk before opening IndexedDB. Keeping the parsed
      // state alive through Dexie export raised the renderer's peak heap.
      await window.electron.ipcRenderer.invoke(MigrationIpcChannels.ReportExportStage, { source: 'redux' })
      const reduxExporter = new ReduxExporter()
      const reduxResult = await reduxExporter.export(exportPaths.reduxExportPath)
      logger.info('Redux data exported', {
        slicesFound: reduxResult.slicesFound,
        slicesMissing: reduxResult.slicesMissing,
        exportPath: reduxResult.exportPath
      })

      // Export Dexie data
      const dexieExporter = new DexieExporter(exportPaths.dexieExportPath)

      await dexieExporter.exportAll(async (p) => {
        if (p.progress === 0) {
          await window.electron.ipcRenderer.invoke(MigrationIpcChannels.ReportExportStage, {
            source: 'dexie',
            table: p.table
          })
        }
        logger.info('Dexie export progress', p)
      })

      logger.info('Dexie data exported', { exportPath: exportPaths.dexieExportPath })

      // Export localStorage data
      await window.electron.ipcRenderer.invoke(MigrationIpcChannels.ReportExportStage, { source: 'localStorage' })
      const localStorageExporter = new LocalStorageExporter(exportPaths.localStorageExportDirectory)
      await localStorageExporter.export()
      logger.info('localStorage data exported', {
        entryCount: localStorageExporter.getEntryCount(),
        filePath: exportPaths.localStorageExportPath
      })

      // Start migration with exported data
      await actions.startMigration({
        reduxExportPath: reduxResult.exportPath,
        dexieExportPath: exportPaths.dexieExportPath,
        localStorageExportPath: exportPaths.localStorageExportPath
      })
    } catch (error) {
      logger.error('Failed to start migration', error as Error)
      const message = errorMessage(error)
      setLocalMigrationError(message)
      void window.electron.ipcRenderer.invoke(MigrationIpcChannels.ReportError, message)
    } finally {
      startGuardRef.current = false
      setIsLoading(false)
    }
  }

  const openDownloadPage = async () => {
    try {
      if (await actions.openDownloadPage(i18n.language)) {
        setV1DialogOpen(false)
        return
      }
      showErrorToast(t('migration.error.v1_fallback.open_failed'))
    } catch (error) {
      logger.error('Failed to open the v1 download page', error as Error)
      showErrorToast(t('migration.error.v1_fallback.open_failed'))
    }
  }

  const handleDiagnosticSaved = (logs: 'included' | 'not_included') => {
    setDiagnosticExportOpen(false)
    if (diagnosticResultTimerRef.current) clearTimeout(diagnosticResultTimerRef.current)
    diagnosticResultTimerRef.current = setTimeout(() => {
      diagnosticResultTimerRef.current = null
      setDiagnosticResult(logs)
    }, DIALOG_UNMOUNT_DELAY_MS)
  }

  const openDiagnosticsFromError = () => {
    if (window.getSelection()?.toString().trim()) return
    setDiagnosticExportOpen(true)
  }

  const copyMigrationWarnings = async (warnings: string[]) => {
    try {
      await navigator.clipboard.writeText(warnings.map((warning, index) => `${index + 1}. ${warning}`).join('\n'))
      showSuccessToast(t('migration.completed.warning_copy_success'))
    } catch (error) {
      logger.error('Failed to copy migration warnings', error as Error)
      showErrorToast(t('migration.completed.warning_copy_failed'))
    }
  }

  // On success main restarts the app, so there is no resolve path to handle here.
  const handleSkipConfirm = async () => {
    try {
      await actions.skipMigration()
    } catch (error) {
      logger.error('Failed to skip migration', error as Error)
      setSkipOpen(false)
      showErrorToast(t('migration.skip_dialog.failed'))
    }
  }

  const progressMessage = useMemo(() => {
    if (progress.i18nMessage) {
      return t(progress.i18nMessage.key, progress.i18nMessage.params)
    }
    return progress.currentMessage
  }, [progress, t])

  const stage = localMigrationError ? 'error' : progress.stage

  const showRail = stage !== 'version_incompatible'

  const renderStage = () => {
    switch (stage) {
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
              <p className="mt-2 text-muted-foreground text-sm">{t('migration.introduction.subtitle')}</p>
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
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
                    {feature.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground text-sm">{feature.title}</p>
                    <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2.5">
              <Button
                variant="default"
                size="lg"
                className="w-full gap-2"
                loading={isLoading}
                onClick={() => void runMigration()}>
                {t('migration.buttons.start_migration')}
                <ArrowRight size={14} />
              </Button>
              {progress.dataLocation && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/15 px-3 py-2 text-foreground-tertiary text-xs">
                  <FolderOpen size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 break-all">
                    {t('migration.introduction.data_location', { path: progress.dataLocation })}
                  </span>
                </div>
              )}
            </div>
          </div>
        )

      case 'migration':
        return (
          <div className="space-y-4">
            <TopContent>
              <StageBadge tone="primary">
                <Loader2 size={26} strokeWidth={1.5} className="animate-spin" />
              </StageBadge>
              <h2 className="font-semibold text-foreground text-lg tracking-tight">{t('migration.migration.title')}</h2>
              <p className="mt-1.5 text-muted-foreground text-sm">{progressMessage}</p>
            </TopContent>
            <div>
              <div className="mb-2 flex items-center justify-between text-foreground-tertiary text-xs">
                <span className="tabular-nums">{Math.round(progress.overallProgress)}%</span>
              </div>
              <ProgressBar value={progress.overallProgress} />
            </div>
            <MigratorProgressList migrators={progress.migrators} />
            <p className="pt-0.5 text-center text-muted-foreground text-xs">{t('migration.migration.do_not_close')}</p>
          </div>
        )

      case 'completed': {
        const summary = progress.summary
        const warnings = [
          ...(progress.warningMessages ?? []).map((warning) => t(warning.key, warning.params)),
          ...(progress.warnings ?? [])
        ]
        const hasWarnings = warnings.length > 0
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
              <p className="mt-2.5 text-muted-foreground text-sm leading-relaxed">
                {t(hasWarnings ? 'migration.completed.description_with_warnings' : 'migration.completed.description')}
              </p>
            </TopContent>

            {summary && (
              <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-muted/10 py-4">
                <Stat>
                  <span className="font-semibold text-2xl text-foreground tabular-nums">
                    {summary.completedMigrators}/{summary.totalMigrators}
                  </span>
                  <span className="text-foreground-tertiary text-xs">{t('migration.completed.steps_label')}</span>
                </Stat>
                <Stat>
                  <span className="font-semibold text-2xl text-foreground tabular-nums">{summary.itemsProcessed}</span>
                  <span className="text-foreground-tertiary text-xs">{t('migration.completed.items_label')}</span>
                </Stat>
                <Stat>
                  <span className="font-semibold text-2xl text-foreground tabular-nums">
                    {formatDuration(summary.durationMs)}
                  </span>
                  <span className="text-foreground-tertiary text-xs">{t('migration.completed.duration_label')}</span>
                </Stat>
              </div>
            )}

            {hasWarnings && (
              <Dialog open={warningsDialogOpen} onOpenChange={setWarningsDialogOpen}>
                <div className="flex justify-center" data-migration-warning-trigger="">
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto w-fit gap-2 px-0 py-0 text-warning hover:text-warning">
                      <AlertTriangle size={14} className="shrink-0" />
                      {t('migration.completed.warning_heading', { count: warnings.length })}
                    </Button>
                  </DialogTrigger>
                </div>
                <DialogContent size="lg" className="max-h-[calc(100vh-2rem)] overflow-hidden">
                  <DialogHeader>
                    <DialogTitle>{t('migration.completed.warning_heading', { count: warnings.length })}</DialogTitle>
                    <DialogDescription>{t('migration.completed.warning_description')}</DialogDescription>
                  </DialogHeader>
                  <Scrollbar className="max-h-[50vh]">
                    <ul className="text-foreground text-sm leading-relaxed">
                      {warnings.map((warning, index) => (
                        <li key={index} className="wrap-break-words">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </Scrollbar>
                  <Button
                    type="button"
                    variant="emphasis"
                    size="lg"
                    className="w-full gap-2"
                    onClick={() => void copyMigrationWarnings(warnings)}>
                    <Copy size={14} />
                    {t('migration.completed.warning_copy')}
                  </Button>
                </DialogContent>
              </Dialog>
            )}

            <Button variant="default" size="lg" className="w-full gap-2" onClick={() => actions.restart()}>
              <RotateCcw size={14} />
              {t('migration.buttons.restart')}
            </Button>
          </div>
        )
      }

      case 'error':
        return (
          <div className="space-y-4">
            <TopContent>
              <StageBadge tone="destructive">
                <AlertTriangle size={26} strokeWidth={1.5} />
              </StageBadge>
              <h2 className="font-semibold text-foreground text-lg tracking-tight">{t('migration.error.title')}</h2>
              <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{t('migration.error.description')}</p>
            </TopContent>
            <div
              role="button"
              tabIndex={0}
              aria-label={t('migration.diagnostics.open_from_error')}
              data-migration-error-details=""
              className="cursor-pointer rounded-lg border border-error-border bg-error-subtle px-3.5 py-3 transition-colors hover:border-error focus-visible:border-ring focus-visible:outline-none"
              onClick={openDiagnosticsFromError}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setDiagnosticExportOpen(true)
                }
              }}>
              <p className="wrap-break-words select-text text-error-subtle-foreground text-xs leading-5">
                {t('migration.error.error_prefix')}
                {localMigrationError || lastError || progress.error || t('migration.error.unknown')}
              </p>
            </div>
            <Button
              variant="default"
              size="lg"
              className="w-full gap-2"
              onClick={() => {
                setLocalMigrationError(null)
                void actions.retry()
              }}>
              <RotateCcw size={14} />
              {t('migration.buttons.retry')}
            </Button>
            <MigrationOptionsDialog
              open={moreOptionsOpen}
              onOpenChange={setMoreOptionsOpen}
              onSkipMigration={() => setSkipOpen(true)}
              onContinueV1={() => setV1DialogOpen(true)}
              onCloseApp={() => actions.cancel()}
              onExportDiagnostics={() => setDiagnosticExportOpen(true)}
              showLabel
            />
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
            <div className="space-y-3 rounded-xl border border-border bg-muted/10 px-4 py-3 text-muted-foreground text-sm leading-relaxed">
              <p>{t('migration.version_incompatible.preamble')}</p>
              <p>{progressMessage}</p>
              <p>{t('migration.version_incompatible.ignore_hint')}</p>
            </div>
            <MigrationDiagnosticPanel />
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
        return assertNever(stage)
    }
  }

  return (
    <>
      <div className="flex h-screen w-screen flex-col bg-card text-card-foreground">
        <header className="relative flex h-11 shrink-0 items-center justify-center border-border border-b [-webkit-app-region:drag]">
          <div
            data-migration-language-select=""
            className={cn(
              '-translate-y-1/2 absolute top-1/2 z-10 flex items-center gap-1 [-webkit-app-region:no-drag]',
              isMac ? 'right-3' : 'left-3'
            )}>
            <Select value={i18n.language} onValueChange={(lang) => void i18n.changeLanguage(lang)}>
              <SelectTrigger
                aria-label={t('migration.language.select')}
                size="sm"
                className="h-7 w-auto gap-1.5 border-0 bg-transparent px-1.5 text-muted-foreground text-xs shadow-none hover:bg-transparent hover:text-foreground focus-visible:bg-transparent focus-visible:text-foreground aria-expanded:border-transparent aria-expanded:ring-0 dark:bg-transparent [&_svg]:size-3.5 [&_svg]:opacity-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">中文</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
              </SelectContent>
            </Select>
            <Tooltip content={t(themeLabelKey[themeMode] ?? themeLabelKey.system)} delay={800}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t(themeLabelKey[themeMode] ?? themeLabelKey.system)}
                onClick={toggleTheme}
                className="text-muted-foreground hover:bg-muted/40 hover:text-foreground">
                <ThemeIcon className="size-3.5" strokeWidth={1.6} />
              </Button>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2">
            <img src={AppLogo} alt="Cherry Studio" className="h-4.5 w-4.5 rounded-full object-cover" />
            <span className="font-medium text-foreground text-sm">Cherry Studio</span>
            <span className="text-foreground-tertiary">·</span>
            <span className="text-foreground-tertiary text-xs">{t('migration.title')}</span>
          </div>
          <MigrationWindowControls />
        </header>

        <div className="flex min-h-0 flex-1">
          {showRail && <StepRail stage={stage} />}
          <main
            className={cn(
              'relative min-w-0 flex-1 overflow-y-auto',
              progress.stage === 'completed' && 'overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            )}>
            {stage === 'introduction' && (
              <div className="absolute top-2 right-3 z-10">
                <MigrationOptionsDialog
                  open={moreOptionsOpen}
                  onOpenChange={setMoreOptionsOpen}
                  onSkipMigration={() => setSkipOpen(true)}
                  disabled={isLoading}
                />
              </div>
            )}
            <div className="flex min-h-full w-full flex-col justify-center px-16 py-8">{renderStage()}</div>
          </main>
        </div>

        <SkipMigrationDialog open={skipOpen} onOpenChange={setSkipOpen} onConfirm={() => void handleSkipConfirm()} />
        <V1DownloadDialog
          open={v1DialogOpen}
          onOpenChange={setV1DialogOpen}
          onDownload={() => void openDownloadPage()}
        />
        <Dialog open={diagnosticExportOpen} onOpenChange={setDiagnosticExportOpen}>
          <DialogContent size="default">
            <DialogHeader>
              <DialogTitle>{t('migration.diagnostics.title')}</DialogTitle>
              <DialogDescription>{t('migration.diagnostics.export_description')}</DialogDescription>
            </DialogHeader>
            <MigrationDiagnosticPanel embedded showPrivacy={false} onSaved={handleDiagnosticSaved} />
          </DialogContent>
        </Dialog>
        {diagnosticResult && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setDiagnosticResult(null)
            }}>
            <DialogContent size="sm">
              <DialogHeader>
                <DialogTitle>{t('migration.diagnostics.saved_title')}</DialogTitle>
                <DialogDescription className="sr-only">{t('migration.diagnostics.saved_local')}</DialogDescription>
              </DialogHeader>
              <MigrationDiagnosticPanel embedded savedLogs={diagnosticResult} showPrivacy={false} />
            </DialogContent>
          </Dialog>
        )}
        <CloseMigrationDialog
          open={closeConfirmOpen}
          onOpenChange={(open) => {
            setCloseConfirmOpen(open)
            // Dismissed via Continue / Esc / backdrop — tell main to drop its pending-close flag so a
            // later close re-prompts instead of force-quitting. (The Quit path closes via the
            // controlled prop in onConfirm, which doesn't fire onOpenChange, so this never runs on quit.)
            if (!open) {
              void window.electron.ipcRenderer.invoke(MigrationIpcChannels.CancelClose)
            }
          }}
          onConfirm={async () => {
            setCloseConfirmOpen(false)
            // Main returns false when it defers the quit until an in-flight migration
            // write settles; show a notice instead of quitting right away.
            const quitting = await window.electron.ipcRenderer.invoke(MigrationIpcChannels.ConfirmQuit)
            if (!quitting) {
              setQuitDeferred(true)
            }
          }}
        />
        {quitDeferred && (
          <div className="pointer-events-none fixed inset-x-0 top-16 z-20 flex justify-center px-4">
            <Alert
              type="info"
              showIcon
              message={t('migration.window.confirm_close.quit_pending')}
              className="pointer-events-auto w-auto shadow-md"
            />
          </div>
        )}
      </div>
      <ToastHost />
    </>
  )
}

export default MigrationApp
