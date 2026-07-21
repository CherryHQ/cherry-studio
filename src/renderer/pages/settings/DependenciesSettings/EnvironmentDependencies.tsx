import {
  Badge,
  Button,
  ConfirmDialog,
  DescriptionSwitch,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  SelectDropdown
} from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import {
  BinaryInstallErrorDialog,
  BinaryInstallFailureRow,
  BinaryInstallingHint,
  type BinaryOperationError
} from '@renderer/components/BinaryInstallErrorDialog'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { interpretBinarySnapshot } from '@renderer/utils/binarySnapshot'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { CustomToolDefinition } from '@shared/data/preference/preferenceTypes'
import {
  BINARY_INSTALL_PREFERENCE_KEYS,
  type BinaryToolPreset,
  isRuntimeDependency,
  PRESETS_BINARY_TOOLS,
  validateBinaryToolDefinition
} from '@shared/data/presets/binaryTools'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import type {
  BinaryApplication,
  BinaryAvailability,
  BinaryOperation,
  BinaryRemoveResult,
  BinaryToolSnapshot
} from '@shared/types/binary'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowBigUp,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  SquareArrowOutUpRight,
  Terminal,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  GITHUB_MIRROR_PRESETS,
  type InstallSettingPreset,
  NPM_REGISTRY_PRESETS,
  PIP_INDEX_PRESETS
} from './binaryInstallPresets'

const logger = loggerService.withContext('EnvironmentDependencies')

type CleanupBlockedResult = Extract<BinaryRemoveResult, { status: 'cleanup_blocked' }>

const ToolIcon: FC<{ icon?: string; className?: string }> = ({ icon, className }) => {
  if (icon) {
    return <Icon icon={icon} className={cn('size-5', className)} />
  }
  return <Terminal className={cn('size-5', className)} />
}

type ToolSource = BinaryAvailability['source']

// Code CLIs are installed through BinaryManager too, but have their own
// management surface (the Code CLI page) — keep them out of this inventory.
const CODE_CLI_BINARIES = new Set(CODE_CLI_TOOL_PRESETS.map((preset) => preset.executable))

interface EnvironmentDependenciesProps {
  mini?: boolean
}

const EnvironmentDependencies: FC<EnvironmentDependenciesProps> = ({ mini = false }) => {
  const [snapshots, setSnapshots] = useState<Record<string, BinaryToolSnapshot>>({})
  const [resolutionsReady, setResolutionsReady] = useState(false)
  const [latestVersions, setLatestVersions] = useState<Record<string, string> | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showInstallSettings, setShowInstallSettings] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; runtime: boolean; custom: boolean } | null>(null)
  const [installError, setInstallError] = useState<BinaryOperationError | null>(null)
  // A custom tool whose backend cleanup was blocked: preserve the typed result so
  // the second confirmation can explain why cleanup stopped before offering the
  // explicitly destructive definition-only escape hatch.
  const [definitionFallback, setDefinitionFallback] = useState<{
    name: string
    result: CleanupBlockedResult
  } | null>(null)
  // Retain the last target so the confirm dialog keeps its message during the close animation.
  const deleteTargetRef = useRef<{ name: string; runtime: boolean; custom: boolean }>({
    name: '',
    runtime: false,
    custom: false
  })
  if (deleteTarget) deleteTargetRef.current = deleteTarget
  const { t } = useTranslation()
  const navigate = useNavigate()
  const mountedRef = useRef(true)
  const resolutionRequestIdRef = useRef(0)
  const latestRequestIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshState = useCallback(async () => {
    const requestId = ++resolutionRequestIdRef.current
    try {
      const nextSnapshots = await ipcApi.request(
        'binary.get_tool_snapshots',
        PRESETS_BINARY_TOOLS.map((tool) => tool.name)
      )
      if (!mountedRef.current || requestId !== resolutionRequestIdRef.current) return
      setSnapshots(nextSnapshots)
      setResolutionsReady(true)
    } catch (error) {
      logger.error('Failed to refresh binary state', error as Error)
    }
  }, [])

  const fetchLatestVersions = useCallback(
    async (force = false): Promise<Record<string, string> | null> => {
      const requestId = ++latestRequestIdRef.current
      setCheckingUpdates(true)
      try {
        const versions = await ipcApi.request('binary.get_latest_versions', force)
        if (mountedRef.current && requestId === latestRequestIdRef.current) {
          setLatestVersions(versions)
          // Only the manual refresh (force) gets a toast — the background check on
          // mount must stay silent.
          if (force) toast.success(t('settings.dependencies.updateCheckSuccess'))
        }
        return versions
      } catch (error) {
        logger.error('Failed to fetch latest versions', error as Error)
        if (force) toast.error(`${t('settings.dependencies.updateCheckFailed')}: ${formatErrorMessage(error)}`)
        return null
      } finally {
        if (mountedRef.current && requestId === latestRequestIdRef.current) setCheckingUpdates(false)
      }
    },
    [t]
  )

  useEffect(() => {
    void refreshState()
  }, [refreshState])

  useEffect(() => {
    // Update-version data is only rendered in the full view; mini mode (mounted
    // by McpServersList) skips the fetch to avoid hitting rate-limited registries.
    if (mini) return
    void fetchLatestVersions(false)
  }, [fetchLatestVersions, mini])

  useIpcOn('binary.availability_changed', () => {
    setLatestVersions(null)
    void refreshState()
  })

  // Custom tools are exactly the snapshots that carry a user-added definition.
  // Runtime dependencies mise auto-installs do not appear here unless the user
  // added them as a custom tool — availability alone never mints a card.
  const inventorySnapshots = useMemo(
    () => Object.values(snapshots).filter((snapshot) => !CODE_CLI_BINARIES.has(snapshot.name) && !!snapshot.definition),
    [snapshots]
  )
  // Operation status is part of each snapshot, so a window mounted mid-mutation
  // renders the same state as the window that initiated it. Install/update are
  // name-only: main resolves the fixed/custom recipe and never persists a recipe
  // the renderer supplied. Card-level failures surface through the operation
  // state (BinaryInstallFailureRow), not a dialog.
  const installTool = async (name: string, targetVersion?: string): Promise<void> => {
    try {
      await ipcApi.request('binary.install_tool', { name, ...(targetVersion ? { targetVersion } : {}) })
    } catch (error) {
      logger.error('Failed to install tool', error as Error)
    } finally {
      await refreshState()
    }
  }

  const handleAddCustomTool = async (tool: CustomToolDefinition) => {
    try {
      validateBinaryToolDefinition(tool)
    } catch {
      toast.error(t('settings.dependencies.invalidTool'))
      throw new Error('invalid')
    }

    const allNames = [
      ...PRESETS_BINARY_TOOLS.map((p) => p.name),
      ...inventorySnapshots.map((snapshot) => snapshot.name),
      ...CODE_CLI_BINARIES
    ]
    if (allNames.includes(tool.name)) {
      toast.error(t('settings.dependencies.duplicateName'))
      throw new Error('duplicate')
    }

    try {
      // Custom Add is the only route that carries an arbitrary recipe. Main persists
      // the definition before any backend work and authoritatively rejects fixed-name
      // and recipe collisions, so the recipe is sent exactly as entered — no
      // discovered-runtime version pin is grafted on.
      await ipcApi.request('binary.add_custom_tool', tool)
    } catch (error) {
      logger.error('Failed to add custom tool', error as Error)
      setInstallError({ name: tool.name, message: formatErrorMessage(error), action: 'install' })
      throw error
    } finally {
      await refreshState()
    }
  }

  // BinaryManager cleans the physical binary from the backend and, for a custom
  // tool, drops its durable definition. A fail-closed cleanup_blocked removes
  // nothing: a custom tool can still drop just its definition after an explicit
  // second confirmation; a fixed tool has none, so its block is only an error.
  const handleRemoveTool = async (target: { name: string; custom: boolean }) => {
    try {
      const result = await ipcApi.request('binary.remove_tool', { name: target.name })
      if (result.status === 'cleanup_blocked') {
        if (target.custom) {
          setDefinitionFallback({ name: target.name, result })
        } else {
          setInstallError({
            name: target.name,
            message: result.message ?? t('common.delete_failed'),
            action: 'remove'
          })
        }
        return
      }
    } catch (error) {
      logger.error('Failed to remove tool', error as Error)
      toast.error(formatErrorMessage(error))
    } finally {
      setDeleteTarget(null)
      await refreshState()
    }
  }

  // Second stage: drop only the custom definition (the backend stays as-is).
  const handleRemoveDefinition = async (name: string) => {
    try {
      await ipcApi.request('binary.remove_tool', { name, definitionOnly: true })
    } catch (error) {
      logger.error('Failed to remove tool definition', error as Error)
      toast.error(formatErrorMessage(error))
    } finally {
      setDefinitionFallback(null)
      await refreshState()
    }
  }

  const openToolDir = (binaryPath: string) => {
    const separator = Math.max(binaryPath.lastIndexOf('/'), binaryPath.lastIndexOf('\\'))
    void ipcApi.request('system.shell.open_path', separator > 0 ? binaryPath.slice(0, separator) : binaryPath)
  }

  // One unified inventory: presets first, then the user's custom tools (Code CLIs
  // stay on their dedicated page).
  const presetNames = new Set(PRESETS_BINARY_TOOLS.map((tool) => tool.name))
  const extraTools = inventorySnapshots.filter((snapshot) => !presetNames.has(snapshot.name))
  const totalCount = PRESETS_BINARY_TOOLS.length + extraTools.length

  if (mini) {
    if (!resolutionsReady) {
      return null
    }

    const uvAvailable = !!snapshots.uv && snapshots.uv.availability.source !== 'none'
    const bunAvailable = !!snapshots.bun && snapshots.bun.availability.source !== 'none'
    if (uvAvailable && bunAvailable) {
      return null
    }

    return (
      <Button
        className="nodrag h-8 rounded-lg px-2 text-destructive shadow-none hover:text-destructive"
        variant="ghost"
        aria-label={t('settings.dependencies.title')}
        title={t('settings.dependencies.title')}
        onClick={() => navigate({ to: '/settings/dependencies' })}>
        <TriangleAlert size={14} />
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="font-semibold text-[15px] text-foreground leading-6">{t('settings.dependencies.title')}</h1>
          <span className="text-muted-foreground/50 text-xs">{totalCount}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-foreground-muted hover:text-foreground"
            onClick={() => void fetchLatestVersions(true)}
            disabled={checkingUpdates}
            aria-label={t('settings.dependencies.checkUpdates')}
            title={t('settings.dependencies.checkUpdates')}>
            {checkingUpdates ? (
              <Loader2 className="size-3 motion-safe:animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-foreground-muted hover:text-foreground"
            onClick={() => setShowInstallSettings(true)}
            aria-label={t('settings.dependencies.installSettings.title')}
            title={t('settings.dependencies.installSettings.title')}>
            <Settings2 className="size-3" />
          </Button>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setShowAddDialog(true)}>
            <Plus className="size-3.5" />
            {t('settings.dependencies.addTool')}
          </Button>
        </div>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{t('settings.dependencies.description')}</p>
      </div>

      <div role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PRESETS_BINARY_TOOLS.map((tool) => {
          const snapshot = snapshots[tool.name]
          const latestVersion = latestVersions?.[tool.name]
          const view = interpretBinarySnapshot(snapshot, { latest: latestVersion })
          return (
            <BinaryToolPresetCard
              key={tool.name}
              tool={tool}
              source={view.source}
              applicationStatus={view.applicationStatus}
              systemPath={view.systemPath}
              installedVersion={view.installedVersion}
              latestVersion={view.hasUpdate ? latestVersion : undefined}
              operation={snapshot?.operation}
              onShowError={(message) =>
                setInstallError({
                  name: tool.name,
                  message,
                  action: snapshot?.operation?.status === 'failed' ? snapshot.operation.action : 'install'
                })
              }
              // A failed update surfaces its Retry through this same install
              // handler, so carry the failed op's target — a name-only retry would
              // hit the applied no-op and clear the failure without re-updating.
              onInstall={() =>
                installTool(
                  tool.name,
                  snapshot?.operation?.status === 'failed' ? snapshot.operation.targetVersion : undefined
                )
              }
              onUpdate={() => installTool(tool.name, latestVersion ?? 'latest')}
              onOpenPath={() => view.resolvedPath && openToolDir(view.resolvedPath)}
              onRemove={() => setDeleteTarget({ name: tool.name, runtime: false, custom: false })}
            />
          )
        })}
        {extraTools.map((snapshot) => {
          const latestVersion = latestVersions?.[snapshot.name]
          const view = interpretBinarySnapshot(snapshot, { latest: latestVersion })
          // Every inventory card carries a custom definition, so its recipe is
          // authoritative — availability never supplies the displayed spec.
          const toolSpec = snapshot.definition?.tool ?? snapshot.name
          const runtime = isRuntimeDependency(toolSpec)
          return (
            <CustomToolCard
              key={snapshot.name}
              tool={snapshot}
              toolSpec={toolSpec}
              runtime={runtime}
              available={view.installed}
              systemPath={view.systemPath}
              installedVersion={view.installedVersion}
              latestVersion={view.hasUpdate ? latestVersion : undefined}
              operation={snapshot.operation}
              onShowError={(message) =>
                setInstallError({
                  name: snapshot.name,
                  message,
                  action: snapshot.operation?.status === 'failed' ? snapshot.operation.action : 'install'
                })
              }
              onInstall={() =>
                installTool(
                  snapshot.name,
                  snapshot.operation?.status === 'failed' ? snapshot.operation.targetVersion : undefined
                )
              }
              onUpdate={() => installTool(snapshot.name, latestVersion ?? 'latest')}
              onOpenPath={() => view.resolvedPath && openToolDir(view.resolvedPath)}
              onRemove={() => setDeleteTarget({ name: snapshot.name, runtime, custom: true })}
            />
          )
        })}
      </div>

      <AddToolDialog open={showAddDialog} onOpenChange={setShowAddDialog} onAdd={handleAddCustomTool} />
      <InstallSettingsDialog open={showInstallSettings} onOpenChange={setShowInstallSettings} />

      <BinaryInstallErrorDialog error={installError} onOpenChange={(open) => !open && setInstallError(null)} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t(
          deleteTargetRef.current.custom
            ? 'settings.dependencies.removeConfirmTitle'
            : 'settings.dependencies.uninstallConfirmTitle'
        )}
        description={t(
          deleteTargetRef.current.runtime
            ? 'settings.dependencies.removeRuntimeConfirmMessage'
            : deleteTargetRef.current.custom
              ? 'settings.dependencies.removeConfirmMessage'
              : 'settings.dependencies.uninstallConfirmMessage',
          { name: deleteTargetRef.current.name }
        )}
        confirmText={t(deleteTargetRef.current.custom ? 'common.delete' : 'settings.dependencies.uninstall')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={async () => {
          if (deleteTarget) await handleRemoveTool({ name: deleteTarget.name, custom: deleteTarget.custom })
        }}
      />

      <ConfirmDialog
        open={!!definitionFallback}
        onOpenChange={(open) => !open && setDefinitionFallback(null)}
        title={t('settings.dependencies.removeDefinitionOnlyConfirmTitle')}
        description={t('settings.dependencies.removeDefinitionOnlyConfirmMessage', {
          name: definitionFallback?.name,
          details:
            definitionFallback?.result.reason === 'dependency_blocked' && definitionFallback.result.dependents?.length
              ? t('settings.dependencies.removeDefinitionOnlyDependents', {
                  dependents: definitionFallback.result.dependents.join(', ')
                })
              : (definitionFallback?.result.message ?? definitionFallback?.result.reason)
        })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={async () => {
          if (definitionFallback) await handleRemoveDefinition(definitionFallback.name)
        }}
      />
    </div>
  )
}

const BinaryToolPresetCard: FC<{
  tool: BinaryToolPreset
  source: ToolSource
  applicationStatus?: BinaryApplication['status']
  systemPath?: string
  installedVersion?: string
  latestVersion?: string
  operation?: BinaryOperation
  onShowError: (message: string) => void
  onInstall: () => void
  onUpdate: () => void
  onOpenPath: () => void
  onRemove: () => void
}> = ({
  tool,
  source,
  applicationStatus,
  systemPath,
  installedVersion,
  latestVersion,
  operation,
  onShowError,
  onInstall,
  onUpdate,
  onOpenPath,
  onRemove
}) => {
  const { t } = useTranslation()
  const description = t(`settings.dependencies.tools.${tool.name}`)
  const present = source !== 'none'
  const isBundled = source === 'bundled'
  const isSystem = source === 'system'
  const installing = operation?.status === 'installing'
  const removing = operation?.status === 'removing'
  const failedInstall = operation?.status === 'failed' && operation.action === 'install'
  const failedRemove = operation?.status === 'failed' && operation.action === 'remove'
  const busy = installing || removing
  // Backend control authority is the live application fact — a fixed tool carries
  // no custom definition. `applied` exposes Update + Uninstall; `broken` exposes
  // Retry + Uninstall; an `absent`+`none` tool offers Install; an externally
  // satisfied (bundled/system) absent tool stays read-only.
  const applied = applicationStatus === 'applied'
  const broken = applicationStatus === 'broken'
  const backendControllable = applied || broken
  const canInstall =
    (applicationStatus === 'absent' && source === 'none') || applicationStatus === 'unknown' || broken || failedInstall

  return (
    <div
      role="listitem"
      className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors duration-200 ease-in-out hover:border-border-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              present ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            )}>
            <ToolIcon icon={tool.icon} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground text-sm leading-5">{tool.displayName}</span>
              {tool.displayName !== tool.name && (
                <span className="text-muted-foreground/60 text-xs">({tool.name})</span>
              )}
            </div>
            {present && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                {installedVersion && (
                  <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[11px] leading-4">
                    v{installedVersion}
                  </Badge>
                )}
                {latestVersion && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-success/40 bg-success/10 px-1.5 py-0 text-[11px] text-success leading-4">
                    <ArrowBigUp className="size-2.5" />v{latestVersion}
                  </Badge>
                )}
                {isBundled && (
                  <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] leading-4">
                    {t('settings.dependencies.source.bundled')}
                  </Badge>
                )}
                {isSystem && (
                  <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] leading-4" title={systemPath}>
                    {t('settings.dependencies.source.system')}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        {backendControllable && (
          <div className="flex shrink-0 items-center gap-1">
            {applied && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-foreground-muted hover:text-foreground"
                onClick={onUpdate}
                disabled={busy}
                title={t('settings.dependencies.update')}>
                <RefreshCw className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground-muted hover:text-destructive"
              onClick={onRemove}
              disabled={busy}
              aria-label={t('settings.dependencies.uninstall')}
              title={t('settings.dependencies.uninstall')}>
              {removing ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : <Trash2 className="size-3.5" />}
            </Button>
          </div>
        )}
      </div>

      <p className="mt-2.5 line-clamp-2 text-muted-foreground text-xs leading-4" title={description}>
        {description}
      </p>

      <div className="mt-3 flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-foreground-muted transition-colors hover:text-foreground"
          onClick={() => void ipcApi.request('system.shell.open_website', tool.repoUrl)}>
          <ExternalLink className="size-3 shrink-0" />
          <span className="truncate">{tool.repoUrl.replace('https://github.com/', '')}</span>
        </button>
        {tool.homepage && (
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-foreground-muted transition-colors hover:text-foreground"
            onClick={() => void ipcApi.request('system.shell.open_website', tool.homepage!)}>
            <SquareArrowOutUpRight className="size-3 shrink-0" />
            <span className="truncate">{tool.homepage.replace(/^https?:\/\//, '')}</span>
          </button>
        )}
        {present && (
          <button
            type="button"
            onClick={onOpenPath}
            aria-label={t('settings.dependencies.openBinariesDir')}
            title={t('settings.dependencies.openBinariesDir')}
            className="inline-flex shrink-0 items-center gap-1 text-[11px] text-foreground-muted transition-colors hover:text-foreground">
            <FolderOpen className="size-3" />
          </button>
        )}
      </div>

      {(failedInstall || failedRemove) && !busy && (
        <BinaryInstallFailureRow error={operation.error} onShowError={() => onShowError(operation.error)} />
      )}

      {canInstall && !failedRemove && (
        <div className="mt-3 border-border border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full gap-1 font-medium text-xs"
            onClick={onInstall}
            disabled={busy}
            loading={installing}>
            {!installing && <Download className="size-3.5" />}
            {installing
              ? t('settings.dependencies.installing')
              : failedInstall || broken || applicationStatus === 'unknown'
                ? t('common.retry')
                : t('settings.mcp.install')}
          </Button>
          {installing && <BinaryInstallingHint />}
        </div>
      )}
    </div>
  )
}

const CustomToolCard: FC<{
  tool: BinaryToolSnapshot
  toolSpec: string
  available: boolean
  runtime?: boolean
  systemPath?: string
  installedVersion?: string
  latestVersion?: string
  operation?: BinaryOperation
  onShowError: (message: string) => void
  onInstall: () => void
  onUpdate: () => void
  onOpenPath: () => void
  onRemove: () => void
}> = ({
  tool,
  toolSpec,
  available,
  runtime = false,
  systemPath,
  installedVersion,
  latestVersion,
  operation,
  onShowError,
  onInstall,
  onUpdate,
  onOpenPath,
  onRemove
}) => {
  const { t } = useTranslation()
  const installed = available
  const installing = operation?.status === 'installing'
  const removing = operation?.status === 'removing'
  const failedInstall = operation?.status === 'failed' && operation.action === 'install'
  const failedRemove = operation?.status === 'failed' && operation.action === 'remove'
  const busy = installing || removing
  const applicationStatus = tool.application?.status
  // A custom card always carries a definition, so Remove is always available.
  // Update needs the exact recipe applied; Install/Retry covers a broken recipe,
  // an absent recipe with no external copy, and a prior failed install. An
  // externally satisfied (bundled/system) tool exposes neither — Remove only.
  const canUpdate = applicationStatus === 'applied'
  const canInstall =
    applicationStatus === 'broken' ||
    applicationStatus === 'unknown' ||
    (applicationStatus === 'absent' && tool.availability.source === 'none') ||
    failedInstall

  return (
    <div
      role="listitem"
      className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors duration-200 ease-in-out hover:border-border-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              installed ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            )}>
            <ToolIcon />
          </div>
          <div className="min-w-0">
            <span className="font-semibold text-foreground text-sm leading-5">{tool.name}</span>
            <div className="mt-0.5 text-muted-foreground text-xs">{toolSpec}</div>
            {installed && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                {installedVersion && (
                  <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[11px] leading-4">
                    v{installedVersion}
                  </Badge>
                )}
                {systemPath && (
                  <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] leading-4" title={systemPath}>
                    {t('settings.dependencies.source.system')}
                  </Badge>
                )}
                {runtime && (
                  <Badge
                    variant="outline"
                    className="gap-1 px-1.5 py-0 text-[11px] leading-4"
                    title={t('settings.dependencies.runtimeDependencyHint')}>
                    {t('settings.dependencies.runtimeDependency')}
                  </Badge>
                )}
                {latestVersion && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-success/40 bg-success/10 px-1.5 py-0 text-[11px] text-success leading-4">
                    <ArrowBigUp className="size-2.5" />v{latestVersion}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {canUpdate && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground-muted hover:text-foreground"
              onClick={onUpdate}
              disabled={busy}
              title={t('settings.dependencies.update')}>
              <RefreshCw className="size-3.5" />
            </Button>
          )}
          {installed && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground-muted hover:text-foreground"
              onClick={onOpenPath}
              aria-label={t('settings.dependencies.openBinariesDir')}
              title={t('common.open')}>
              <FolderOpen className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-foreground-muted hover:text-destructive"
            aria-label={t('settings.dependencies.remove')}
            title={t('settings.dependencies.remove')}
            onClick={onRemove}
            disabled={busy}>
            {removing ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : <Trash2 className="size-3.5" />}
          </Button>
        </div>
      </div>

      {(failedInstall || failedRemove) && !busy && (
        <BinaryInstallFailureRow error={operation.error} onShowError={() => onShowError(operation.error)} />
      )}

      {canInstall && !failedRemove && (
        <div className="mt-3 border-border border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full gap-1 font-medium text-xs"
            onClick={onInstall}
            disabled={busy}
            loading={installing}>
            {!installing && <Download className="size-3.5" />}
            {installing
              ? t('settings.dependencies.installing')
              : failedInstall || applicationStatus === 'broken' || applicationStatus === 'unknown'
                ? t('common.retry')
                : t('settings.mcp.install')}
          </Button>
          {installing && <BinaryInstallingHint />}
        </div>
      )}
    </div>
  )
}

function AddToolDialog({
  open,
  onOpenChange,
  onAdd
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (tool: CustomToolDefinition) => Promise<void>
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ name: string; tool: string }>>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [selectedName, setSelectedName] = useState('')
  const [selectedTool, setSelectedTool] = useState('')
  const [version, setVersion] = useState('')
  const [adding, setAdding] = useState(false)
  const searchIdRef = useRef(0)

  const reset = () => {
    setQuery('')
    setResults([])
    setSearching(false)
    setSelectedName('')
    setSelectedTool('')
    setVersion('')
    setAdding(false)
  }

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setSearchError(false)
      return
    }

    const id = ++searchIdRef.current
    const timer = setTimeout(async () => {
      setSearching(true)
      setSearchError(false)
      try {
        const res = await ipcApi.request('binary.search_registry', query.trim())
        if (id === searchIdRef.current) setResults(res)
      } catch {
        if (id === searchIdRef.current) {
          setResults([])
          setSearchError(true)
        }
      } finally {
        if (id === searchIdRef.current) setSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  const selectResult = (r: { name: string; tool: string }) => {
    setSelectedName(r.name)
    setSelectedTool(r.tool)
    setQuery('')
    setResults([])
  }

  const handleSubmit = async () => {
    if (!selectedName.trim() || !selectedTool.trim()) return
    setAdding(true)
    try {
      await onAdd({
        name: selectedName.trim(),
        tool: selectedTool.trim(),
        requestedVersion: version.trim() || undefined
      })
      reset()
      onOpenChange(false)
    } catch {
      // keep dialog open on failure
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}>
      <DialogContent closeOnOverlayClick={false}>
        <DialogHeader>
          <DialogTitle>{t('settings.dependencies.addTool')}</DialogTitle>
          <DialogDescription>{t('settings.dependencies.addToolDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="relative">
            <Input
              placeholder={t('settings.dependencies.searchRegistry')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {searching && (
              <Loader2 className="-translate-y-1/2 absolute top-1/2 right-3 size-3.5 text-muted-foreground motion-safe:animate-spin" />
            )}
            {results.length > 0 && (
              <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
                {results.map((r) => (
                  <button
                    type="button"
                    key={r.name}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                    onClick={() => selectResult(r)}>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground text-xs">{r.tool}</span>
                  </button>
                ))}
              </div>
            )}
            {searchError && <p className="mt-1 text-destructive text-xs">{t('settings.dependencies.searchFailed')}</p>}
          </div>

          {selectedName && (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <Terminal className="size-4 text-muted-foreground" />
              <span className="font-medium text-sm">{selectedName}</span>
              <span className="text-muted-foreground text-xs">{selectedTool}</span>
            </div>
          )}

          <Input
            placeholder={t('settings.dependencies.fieldVersion')}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedName.trim() || !selectedTool.trim() || adding}>
            {adding && <Loader2 className="size-3.5 motion-safe:animate-spin" />}
            {t('common.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const isValidUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const UrlPresetField: FC<{
  label: string
  description: string
  invalidHint: string
  placeholder: string
  presetLabel: string
  value: string
  presets: readonly InstallSettingPreset[]
  onChange: (value: string) => void
  onCommit: (value: string) => void
}> = ({ label, description, invalidHint, placeholder, presetLabel, value, presets, onChange, onCommit }) => {
  const { t } = useTranslation()
  const inputId = useId()
  const descriptionId = useId()
  const invalid = value.trim() !== '' && !isValidUrl(value.trim())
  // The default preset's value is '' (no override); give it a non-empty
  // dropdown id so selection isn't lost to empty-string falsiness.
  const DEFAULT_ITEM_ID = '__default__'
  const items = presets.map((preset) => ({
    id: preset.url || DEFAULT_ITEM_ID,
    url: preset.url,
    label: t(preset.labelKey)
  }))

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onCommit(event.target.value)}
          className={cn('min-w-0 flex-1', invalid && 'border-destructive')}
        />
        <div className="w-44 shrink-0">
          <SelectDropdown
            items={items}
            selectedId={null}
            onSelect={(id) => {
              const next = id === DEFAULT_ITEM_ID ? '' : id
              onChange(next)
              onCommit(next)
            }}
            placeholder={presetLabel}
            renderSelected={() => null}
            renderItem={(item) => (
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-foreground text-sm">{item.label}</span>
                {item.url && <span className="break-all text-muted-foreground text-xs">{item.url}</span>}
              </div>
            )}
          />
        </div>
      </div>
      <FieldDescription id={descriptionId} className={cn(invalid && 'text-destructive')}>
        {invalid ? invalidHint : description}
      </FieldDescription>
    </Field>
  )
}

const InstallSettingsDialog: FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({
  open,
  onOpenChange
}) => {
  const { t } = useTranslation()
  // Pessimistic updates: these carry a credential (github_token) and a security
  // toggle (signature verification), so persisted state must reflect a write only
  // after it confirms — never an optimistic value a failed write would roll back.
  // Auto-save (no save/cancel buttons): each field commits itself — URLs and the
  // token on blur, the toggle on change — and commit() surfaces write failures.
  const [settings, setSettings] = useMultiplePreferences(BINARY_INSTALL_PREFERENCE_KEYS, { optimistic: false })
  // Local editing buffer for the text fields so pessimistic round-trips don't lag
  // typing. Seeded from settings only on open (warm from preloadAll), never
  // resynced mid-session, so one field's commit can't clobber another field's
  // in-progress edit. // ceiling: a cold cache would show defaults until reopen.
  const [draft, setDraft] = useState(settings)
  const [showToken, setShowToken] = useState(false)
  const tokenId = useId()
  const tokenDescriptionId = useId()
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    if (open) {
      setDraft(settingsRef.current)
      setShowToken(false)
    }
  }, [open])

  const requestClose = (nextOpen: boolean) => {
    if (!nextOpen) setShowToken(false)
    onOpenChange(nextOpen)
  }
  const commit = async (updates: Partial<typeof settings>) => {
    try {
      await setSettings(updates)
    } catch (error) {
      toast.error(formatErrorMessage(error))
    }
  }
  const commitUrl = (key: 'githubMirror' | 'npmRegistry' | 'pipIndexUrl', value: string) => {
    const trimmed = value.trim()
    if (trimmed && !isValidUrl(trimmed)) return // invalid stays in the draft, never persisted
    setDraft((current) => ({ ...current, [key]: trimmed }))
    if (trimmed !== settingsRef.current[key]) void commit({ [key]: trimmed })
  }

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('settings.dependencies.installSettings.title')}</DialogTitle>
          <DialogDescription>{t('settings.dependencies.installSettings.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <UrlPresetField
            label={t('settings.dependencies.installSettings.githubMirror.label')}
            description={t('settings.dependencies.installSettings.githubMirror.help')}
            invalidHint={t('settings.dependencies.installSettings.invalidUrl')}
            placeholder={t('settings.dependencies.installSettings.githubMirror.placeholder')}
            presetLabel={t('settings.dependencies.installSettings.presets')}
            value={draft.githubMirror}
            presets={GITHUB_MIRROR_PRESETS}
            onChange={(githubMirror) => setDraft((current) => ({ ...current, githubMirror }))}
            onCommit={(value) => commitUrl('githubMirror', value)}
          />
          <UrlPresetField
            label={t('settings.dependencies.installSettings.npmRegistry.label')}
            description={t('settings.dependencies.installSettings.npmRegistry.help')}
            invalidHint={t('settings.dependencies.installSettings.invalidUrl')}
            placeholder={t('settings.dependencies.installSettings.npmRegistry.placeholder')}
            presetLabel={t('settings.dependencies.installSettings.presets')}
            value={draft.npmRegistry}
            presets={NPM_REGISTRY_PRESETS}
            onChange={(npmRegistry) => setDraft((current) => ({ ...current, npmRegistry }))}
            onCommit={(value) => commitUrl('npmRegistry', value)}
          />
          <UrlPresetField
            label={t('settings.dependencies.installSettings.pipIndexUrl.label')}
            description={t('settings.dependencies.installSettings.pipIndexUrl.help')}
            invalidHint={t('settings.dependencies.installSettings.invalidUrl')}
            placeholder={t('settings.dependencies.installSettings.pipIndexUrl.placeholder')}
            presetLabel={t('settings.dependencies.installSettings.presets')}
            value={draft.pipIndexUrl}
            presets={PIP_INDEX_PRESETS}
            onChange={(pipIndexUrl) => setDraft((current) => ({ ...current, pipIndexUrl }))}
            onCommit={(value) => commitUrl('pipIndexUrl', value)}
          />
          <Field>
            <FieldLabel htmlFor={tokenId}>{t('settings.dependencies.installSettings.githubToken.label')}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={tokenId}
                type={showToken ? 'text' : 'password'}
                autoComplete="off"
                placeholder={t('settings.dependencies.installSettings.githubToken.placeholder')}
                aria-describedby={tokenDescriptionId}
                value={draft.githubToken}
                onChange={(event) => setDraft((current) => ({ ...current, githubToken: event.target.value }))}
                onBlur={() => {
                  if (draft.githubToken !== settingsRef.current.githubToken) {
                    void commit({ githubToken: draft.githubToken })
                  }
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => setShowToken((current) => !current)}
                  aria-label={t(
                    showToken
                      ? 'settings.dependencies.installSettings.githubToken.hide'
                      : 'settings.dependencies.installSettings.githubToken.show'
                  )}>
                  {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription id={tokenDescriptionId}>
              {t('settings.dependencies.installSettings.githubToken.help')}
            </FieldDescription>
          </Field>
          <DescriptionSwitch
            size="sm"
            label={t('settings.dependencies.installSettings.verifySignatures.label')}
            description={t('settings.dependencies.installSettings.verifySignatures.help')}
            checked={settings.verifySignatures}
            onCheckedChange={(verifySignatures) => void commit({ verifySignatures })}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default EnvironmentDependencies
