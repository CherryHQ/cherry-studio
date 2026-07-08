import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Button,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import AppLogo from '@renderer/assets/images/logo.png'
import { loggerService } from '@renderer/services/LoggerService'
import { isMac } from '@renderer/utils/platform'
import { MigrationIpcChannels, type MigrationStage } from '@shared/data/migration/v2/types'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Database,
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
  MigrationWindowControls,
  MigratorProgressList,
  SkipMigrationDialog
} from './components'
import { DexieExporter, LocalStorageExporter, ReduxExporter } from './exporters'
import { useMigrationActions, useMigrationProgress } from './hooks/useMigrationProgress'

const logger = loggerService.withContext('MigrationApp')

type BadgeTone = 'primary' | 'success' | 'warning' | 'destructive' | 'neutral'

const badgeToneClass: Record<BadgeTone, string> = {
  primary: 'border-primary-mute bg-primary/10 text-primary',
  success: 'border-success-bg-hover bg-success-bg text-success',
  warning: 'border-warning-bg-hover bg-warning-bg text-warning',
  destructive: 'border-error-border bg-error-bg text-error-text',
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
                  isError && 'bg-destructive text-destructive-foreground',
                  !isError && (active || done) && 'bg-primary text-white',
                  !isError && !active && !done && 'border border-border bg-background text-foreground-muted'
                )}>
                {isError ? (
                  <X size={13} strokeWidth={2.5} className="lucide-custom text-white" />
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

type MigrationToolsMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSkipMigration: () => void
  disabled?: boolean
}

const MigrationToolsMenu: React.FC<MigrationToolsMenuProps> = ({ open, onOpenChange, onSkipMigration, disabled }) => {
  const { t } = useTranslation()

  const handleSkipMigration = () => {
    onOpenChange(false)
    onSkipMigration()
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={t('migration.buttons.more_options')}
          className="text-foreground-muted/60 hover:text-foreground-muted">
          <Wrench size={15} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto min-w-36 p-1.5">
        <MenuList className="gap-1">
          <MenuItem
            icon={<AlertTriangle size={14} />}
            label={t('migration.buttons.skip_migration')}
            onClick={handleSkipMigration}
          />
        </MenuList>
      </PopoverContent>
    </Popover>
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
  const [skipOpen, setSkipOpen] = useState(false)
  const [skipMenuOpen, setSkipMenuOpen] = useState(false)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  // Set when the user confirmed quit but main deferred it because a migration write
  // is still in flight; drives the non-blocking "closing after the current step" notice.
  const [quitDeferred, setQuitDeferred] = useState(false)
  const startGuardRef = useRef(false)

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
      const message = errorMessage(error)
      setLocalMigrationError(message)
      void window.electron.ipcRenderer.invoke(MigrationIpcChannels.ReportError, message)
    } finally {
      startGuardRef.current = false
      setIsLoading(false)
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
              <Button
                variant="default"
                size="lg"
                className="w-full gap-2"
                loading={isLoading}
                onClick={() => void runMigration()}>
                {t('migration.buttons.start_migration')}
                <ArrowRight size={14} />
              </Button>
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
              <p className="mt-1.5 text-foreground-muted text-sm">{progressMessage}</p>
            </TopContent>
            <div>
              <div className="mb-2 flex items-center justify-between text-foreground-muted text-xs">
                <span className="tabular-nums">{Math.round(progress.overallProgress)}%</span>
              </div>
              <ProgressBar value={progress.overallProgress} />
            </div>
            <MigratorProgressList migrators={progress.migrators} />
            <p className="pt-0.5 text-center text-foreground-muted text-xs">{t('migration.migration.do_not_close')}</p>
          </div>
        )

      case 'completed': {
        const summary = progress.summary
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

            <Button variant="default" size="lg" className="w-full gap-2" onClick={() => actions.restart()}>
              <RotateCcw size={14} />
              {t('migration.buttons.restart')}
            </Button>

            {warnings.length > 0 && (
              <Accordion
                type="single"
                collapsible
                className="rounded-xl border border-warning-bg-hover bg-warning-bg px-4">
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
            <div className="rounded-xl border border-error-border bg-error-bg px-4 py-3">
              <p className="wrap-break-words text-error-text text-xs leading-relaxed">
                {t('migration.error.error_prefix')}
                {localMigrationError || lastError || progress.error || t('migration.error.unknown')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="lg" onClick={() => actions.cancel()}>
                {t('migration.buttons.close')}
              </Button>
              <Button
                variant="default"
                size="lg"
                className="flex-1 gap-2"
                onClick={() => {
                  setLocalMigrationError(null)
                  void actions.retry()
                }}>
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
        return assertNever(stage)
    }
  }

  return (
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
              className="h-7 w-auto gap-1.5 border-0 bg-transparent px-1.5 text-foreground-muted text-xs shadow-none hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:border-transparent aria-expanded:ring-0 dark:bg-transparent [&_svg]:size-3.5 [&_svg]:opacity-60">
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
              className="text-foreground-muted hover:bg-muted/40 hover:text-foreground">
              <ThemeIcon className="size-3.5" strokeWidth={1.6} />
            </Button>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          <img src={AppLogo} alt="Cherry Studio" className="h-4.5 w-4.5 rounded-full object-cover" />
          <span className="font-medium text-foreground text-sm">Cherry Studio</span>
          <span className="text-foreground-muted">·</span>
          <span className="text-foreground-muted text-xs">{t('migration.title')}</span>
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
          {progress.stage === 'introduction' && (
            <div className="absolute top-2 right-3 z-10">
              <MigrationToolsMenu
                open={skipMenuOpen}
                onOpenChange={setSkipMenuOpen}
                onSkipMigration={() => setSkipOpen(true)}
                disabled={isLoading}
              />
            </div>
          )}
          <div className="flex min-h-full w-full flex-col justify-center px-16 py-8">{renderStage()}</div>
        </main>
      </div>

      <SkipMigrationDialog open={skipOpen} onOpenChange={setSkipOpen} onConfirm={() => actions.skipMigration()} />
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
  )
}

export default MigrationApp
