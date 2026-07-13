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
import { useSharedCache } from '@data/hooks/useCache'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import {
  BinaryInstallErrorDialog,
  BinaryInstallFailureRow,
  BinaryInstallingHint
} from '@renderer/components/BinaryInstallErrorDialog'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { ManagedBinary } from '@shared/data/preference/preferenceTypes'
import {
  type BinaryToolPreset,
  isRuntimeDependency,
  PRESETS_BINARY_TOOLS,
  validateManagedBinary
} from '@shared/data/presets/binaryTools'
import { CLI_BINARY_NAMES } from '@shared/data/presets/codeCliTools'
import type { BinaryResolutions, BinaryToolInventoryEntry } from '@shared/types/binary'
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
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { gt as semverGt, valid as semverValid } from 'semver'

import {
  GITHUB_MIRROR_PRESETS,
  type InstallSettingPreset,
  NPM_REGISTRY_PRESETS,
  PIP_INDEX_PRESETS
} from './binaryInstallPresets'
import LocalModelsSection from './LocalModelsSection'

const logger = loggerService.withContext('EnvironmentDependencies')

const BINARY_INSTALL_PREFERENCE_KEYS = {
  githubMirror: 'feature.binary.install.github_mirror',
  githubToken: 'feature.binary.install.github_token',
  npmRegistry: 'feature.binary.install.npm_registry',
  pipIndexUrl: 'feature.binary.install.pip_index_url',
  verifySignatures: 'feature.binary.install.verify_signatures'
} as const

const isNewerVersion = (latest?: string, installed?: string): boolean => {
  const validLatest = latest ? semverValid(latest) : null
  const validInstalled = installed ? semverValid(installed) : null
  if (!validLatest || !validInstalled) return false
  try {
    return semverGt(validLatest, validInstalled)
  } catch {
    return false
  }
}

const ToolIcon: FC<{ icon?: string; className?: string }> = ({ icon, className }) => {
  if (icon) {
    return <Icon icon={icon} className={cn('size-5', className)} />
  }
  return <Terminal className={cn('size-5', className)} />
}

type ToolSource = 'managed' | 'bundled' | 'system' | 'none'

// Code CLIs are installed through BinaryManager too, but have their own
// management surface (the Code CLI page) — keep them out of this inventory.
const CODE_CLI_BINARIES = new Set<string>(Object.values(CLI_BINARY_NAMES))

interface EnvironmentDependenciesProps {
  mini?: boolean
}

const EnvironmentDependencies: FC<EnvironmentDependenciesProps> = ({ mini = false }) => {
  const [resolutions, setResolutions] = useState<BinaryResolutions>({})
  const [resolutionsReady, setResolutionsReady] = useState(false)
  // Everything recorded in BinaryManager's state file (minus code CLIs) — the
  // page shows the actual install inventory, not just what it can install.
  const [inventoryTools, setInventoryTools] = useState<BinaryToolInventoryEntry[]>([])
  const [latestVersions, setLatestVersions] = useState<Record<string, string> | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [installStates] = useSharedCache('feature.binary.install_states', {})
  const [customTools, setCustomTools] = usePreference('feature.binary.tools')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showInstallSettings, setShowInstallSettings] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; runtime: boolean } | null>(null)
  const [installError, setInstallError] = useState<{ name: string; message: string } | null>(null)
  // Retain the last target so the confirm dialog keeps its message during the close animation.
  const deleteTargetRef = useRef<{ name: string; runtime: boolean }>({ name: '', runtime: false })
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
      const inventory = (await ipcApi.request('binary.list_tools')).filter((tool) => !CODE_CLI_BINARIES.has(tool.name))
      const names = [
        ...new Set([
          ...PRESETS_BINARY_TOOLS.map((tool) => tool.name),
          ...customTools.map((tool) => tool.name),
          ...inventory.map((tool) => tool.name)
        ])
      ]
      const resolved = await ipcApi.request('binary.resolve_tools', names)
      if (!mountedRef.current || requestId !== resolutionRequestIdRef.current) return
      setInventoryTools(inventory)
      setResolutions(resolved)
      setResolutionsReady(true)
    } catch (error) {
      logger.error('Failed to refresh binary state', error as Error)
    }
  }, [customTools])

  const fetchLatestVersions = useCallback(
    async (force = false): Promise<Record<string, string> | null> => {
      const requestId = ++latestRequestIdRef.current
      setCheckingUpdates(true)
      try {
        const versions = await ipcApi.request('binary.get_latest_versions', force)
        if (mountedRef.current && requestId === latestRequestIdRef.current) {
          setLatestVersions(versions)
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
  useIpcOn('binary.reconcile_failed', (names) => {
    toast.error(`${t('settings.dependencies.installError')}: ${names}`)
  })

  // Installing/failed indication comes from the main-owned shared-cache map
  // ('feature.binary.install_states') — shared with the Code CLI page and
  // alive across navigation. Failed cards open the detail dialog on demand;
  // only the add-tool flow surfaces it immediately (the tool is not persisted
  // on failure, so there is no card to carry the error).
  const installTool = async (tool: ManagedBinary, { surfaceErrorDialog = false } = {}): Promise<boolean> => {
    try {
      await ipcApi.request('binary.install_tool', tool)
      return true
    } catch (error) {
      logger.error('Failed to install tool', error as Error)
      if (surfaceErrorDialog) setInstallError({ name: tool.name, message: formatErrorMessage(error) })
      return false
    } finally {
      await refreshState()
    }
  }

  const handleAddCustomTool = async (tool: ManagedBinary) => {
    try {
      validateManagedBinary(tool)
    } catch {
      toast.error(t('settings.dependencies.invalidTool'))
      throw new Error('invalid')
    }

    const allNames = [
      ...PRESETS_BINARY_TOOLS.map((p) => p.name),
      ...customTools.map((c) => c.name),
      ...inventoryTools.filter((tool) => tool.managed).map((tool) => tool.name),
      ...CODE_CLI_BINARIES
    ]
    if (allNames.includes(tool.name)) {
      toast.error(t('settings.dependencies.duplicateName'))
      throw new Error('duplicate')
    }

    const discoveredRuntime = inventoryTools.find(
      (entry) => !entry.managed && entry.name === tool.name && isRuntimeDependency(entry.tool)
    )
    const claimedVersion = tool.version || discoveredRuntime?.version
    const claimedTool = claimedVersion ? { ...tool, version: claimedVersion } : tool
    if (!(await installTool(claimedTool, { surfaceErrorDialog: true }))) throw new Error('install-failed')
    await setCustomTools([...customTools, claimedTool])
  }

  // Uninstalls the mise-managed binary for both preset and custom tools; only custom tools
  // also drop from the persisted list (presets revert to bundled/not-installed on re-probe).
  const handleRemoveTool = async (toolName: string) => {
    try {
      await ipcApi.request('binary.remove_tool', toolName)
      if (customTools.some((t) => t.name === toolName)) {
        await setCustomTools(customTools.filter((t) => t.name !== toolName))
      }
      await refreshState()
      setDeleteTarget(null)
    } catch (error) {
      logger.error('Failed to remove tool', error as Error)
      toast.error(formatErrorMessage(error))
    }
  }

  const openToolDir = (binaryPath: string) => {
    const separator = Math.max(binaryPath.lastIndexOf('/'), binaryPath.lastIndexOf('\\'))
    void ipcApi.request('system.shell.open_path', separator > 0 ? binaryPath.slice(0, separator) : binaryPath)
  }

  // One unified inventory: presets first, then everything else BinaryManager
  // knows about — user-added custom tools plus state-file entries installed by
  // other features (code CLIs excluded; they are managed on the Code CLI page).
  const presetNames = new Set(PRESETS_BINARY_TOOLS.map((tool) => tool.name))
  const extraTools: Array<ManagedBinary | BinaryToolInventoryEntry> = [
    ...customTools.filter((tool) => !CODE_CLI_BINARIES.has(tool.name)),
    ...inventoryTools.filter(
      (tool) => !presetNames.has(tool.name) && !customTools.some((custom) => custom.name === tool.name)
    )
  ]
  const totalCount = PRESETS_BINARY_TOOLS.length + extraTools.length

  if (mini) {
    if (!resolutionsReady) {
      return null
    }

    const uvAvailable = !!resolutions.uv && resolutions.uv.source !== 'none'
    const bunAvailable = !!resolutions.bun && resolutions.bun.source !== 'none'
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
            className="text-muted-foreground/50 hover:text-foreground"
            onClick={() => void fetchLatestVersions(true)}
            disabled={checkingUpdates}
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
            className="text-muted-foreground/50 hover:text-foreground"
            onClick={() => setShowInstallSettings(true)}
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
          const resolution = resolutions[tool.name] ?? { source: 'none' as const }
          const source: ToolSource = resolution.source
          const systemPath = resolution.source === 'system' ? resolution.path : undefined
          const resolvedPath = resolution.source === 'none' ? undefined : resolution.path
          const installedVersion =
            resolution.source === 'managed' || resolution.source === 'bundled' ? resolution.version : undefined
          const managed = inventoryTools.some((entry) => entry.name === tool.name && entry.managed)
          const latestVersion = latestVersions?.[tool.name]
          const hasUpdate = managed && isNewerVersion(latestVersion, installedVersion)
          const installState = installStates[tool.name]
          return (
            <BinaryToolPresetCard
              key={tool.name}
              tool={tool}
              source={source}
              managed={managed}
              systemPath={systemPath}
              installedVersion={installedVersion}
              latestVersion={hasUpdate ? latestVersion : undefined}
              installing={installState?.status === 'installing'}
              installError={installState?.status === 'failed' ? installState.error : undefined}
              onShowError={(message) => setInstallError({ name: tool.name, message })}
              onInstall={() => installTool({ name: tool.name, tool: tool.tool, version: tool.version })}
              onUpdate={() => installTool({ name: tool.name, tool: tool.tool })}
              onOpenPath={() => resolvedPath && openToolDir(resolvedPath)}
              onRemove={() => setDeleteTarget({ name: tool.name, runtime: false })}
            />
          )
        })}
        {extraTools.map((tool) => {
          const resolution = resolutions[tool.name] ?? { source: 'none' as const }
          const runtime = isRuntimeDependency(tool.tool)
          // Ownership comes only from BinaryManager inventory/state. A custom
          // preference or live mise resolution alone must not make a tool manageable.
          const inventoryEntry = inventoryTools.find((entry) => entry.name === tool.name)
          const readOnly = inventoryEntry?.managed === false
          const managed = inventoryEntry?.managed === true
          const available = resolution.source !== 'none'
          const systemPath = !readOnly && resolution.source === 'system' ? resolution.path : undefined
          const resolvedPath = resolution.source === 'none' ? undefined : resolution.path
          const installedVersion =
            resolution.source === 'managed'
              ? resolution.version || tool.version
              : readOnly
                ? tool.version || undefined
                : undefined
          const latestVersion = latestVersions?.[tool.name]
          const hasUpdate = managed && isNewerVersion(latestVersion, installedVersion)
          const installState = installStates[tool.name]
          return (
            <CustomToolCard
              key={tool.name}
              tool={tool}
              runtime={runtime}
              managed={managed}
              available={available}
              readOnly={readOnly}
              systemPath={systemPath}
              installedVersion={installedVersion}
              latestVersion={hasUpdate ? latestVersion : undefined}
              installing={installState?.status === 'installing'}
              installError={installState?.status === 'failed' ? installState.error : undefined}
              onShowError={(message) => setInstallError({ name: tool.name, message })}
              onInstall={() => installTool(tool)}
              onUpdate={() => installTool({ name: tool.name, tool: tool.tool })}
              onOpenPath={() => resolvedPath && openToolDir(resolvedPath)}
              onRemove={() => setDeleteTarget({ name: tool.name, runtime })}
            />
          )
        })}
      </div>

      {!mini && <LocalModelsSection />}

      <AddToolDialog open={showAddDialog} onOpenChange={setShowAddDialog} onAdd={handleAddCustomTool} />
      <InstallSettingsDialog open={showInstallSettings} onOpenChange={setShowInstallSettings} />

      <BinaryInstallErrorDialog error={installError} onOpenChange={(open) => !open && setInstallError(null)} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('settings.dependencies.removeConfirmTitle')}
        description={t(
          deleteTargetRef.current.runtime
            ? 'settings.dependencies.removeRuntimeConfirmMessage'
            : 'settings.dependencies.removeConfirmMessage',
          { name: deleteTargetRef.current.name }
        )}
        destructive
        onConfirm={async () => {
          if (deleteTarget) await handleRemoveTool(deleteTarget.name)
        }}
      />
    </div>
  )
}

const BinaryToolPresetCard: FC<{
  tool: BinaryToolPreset
  source: ToolSource
  managed: boolean
  systemPath?: string
  installedVersion?: string
  latestVersion?: string
  installing: boolean
  installError?: string
  onShowError: (message: string) => void
  onInstall: () => void
  onUpdate: () => void
  onOpenPath: () => void
  onRemove: () => void
}> = ({
  tool,
  source,
  managed,
  systemPath,
  installedVersion,
  latestVersion,
  installing,
  installError,
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

        {managed && (
          <div className="flex shrink-0 items-center gap-1">
            {present && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-foreground/40 hover:text-foreground"
                onClick={onUpdate}
                disabled={installing}
                title={t('settings.dependencies.update')}>
                {installing ? (
                  <Loader2 className="size-3.5 motion-safe:animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground/40 hover:text-destructive"
              onClick={onRemove}
              disabled={installing}
              aria-label={t('settings.dependencies.remove')}
              title={t('settings.dependencies.remove')}>
              <Trash2 className="size-3.5" />
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
          className="inline-flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
          onClick={() => void ipcApi.request('system.shell.open_website', tool.repoUrl)}>
          <ExternalLink className="size-3 shrink-0" />
          <span className="truncate">{tool.repoUrl.replace('https://github.com/', '')}</span>
        </button>
        {tool.homepage && (
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
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
            className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground">
            <FolderOpen className="size-3" />
          </button>
        )}
      </div>

      {installError && !installing && (
        <BinaryInstallFailureRow error={installError} onShowError={() => onShowError(installError)} />
      )}

      {source === 'none' && (
        <div className="mt-3 border-border border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full gap-1 font-medium text-xs"
            onClick={onInstall}
            disabled={installing}
            loading={installing}>
            {!installing && <Download className="size-3.5" />}
            {installing
              ? t('settings.dependencies.installing')
              : installError
                ? t('common.retry')
                : isBundled
                  ? t('settings.dependencies.install')
                  : t('settings.mcp.install')}
          </Button>
          {installing && <BinaryInstallingHint />}
        </div>
      )}
    </div>
  )
}

const CustomToolCard: FC<{
  tool: ManagedBinary
  managed: boolean
  available: boolean
  runtime?: boolean
  readOnly: boolean
  systemPath?: string
  installedVersion?: string
  latestVersion?: string
  installing: boolean
  installError?: string
  onShowError: (message: string) => void
  onInstall: () => void
  onUpdate: () => void
  onOpenPath: () => void
  onRemove: () => void
}> = ({
  tool,
  managed,
  available,
  runtime = false,
  readOnly,
  systemPath,
  installedVersion,
  latestVersion,
  installing,
  installError,
  onShowError,
  onInstall,
  onUpdate,
  onOpenPath,
  onRemove
}) => {
  const { t } = useTranslation()
  const installed = available

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
            <div className="mt-0.5 text-muted-foreground text-xs">{tool.tool}</div>
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
          {managed && installed && !readOnly && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground/40 hover:text-foreground"
              onClick={onUpdate}
              disabled={installing}
              title={t('settings.dependencies.update')}>
              {installing ? (
                <Loader2 className="size-3.5 motion-safe:animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          )}
          {installed && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground/40 hover:text-foreground"
              onClick={onOpenPath}
              aria-label={t('settings.dependencies.openBinariesDir')}
              title={t('common.open')}>
              <FolderOpen className="size-3.5" />
            </Button>
          )}
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground/40 hover:text-destructive"
              aria-label={t('settings.dependencies.remove')}
              title={t('settings.dependencies.remove')}
              onClick={onRemove}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {installError && !installing && (
        <BinaryInstallFailureRow error={installError} onShowError={() => onShowError(installError)} />
      )}

      {!installed && !readOnly && (
        <div className="mt-3 border-border border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full gap-1 font-medium text-xs"
            onClick={onInstall}
            disabled={installing}
            loading={installing}>
            {!installing && <Download className="size-3.5" />}
            {installing
              ? t('settings.dependencies.installing')
              : installError
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
  onAdd: (tool: ManagedBinary) => Promise<void>
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
      await onAdd({ name: selectedName.trim(), tool: selectedTool.trim(), version: version.trim() || undefined })
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
}> = ({ label, description, invalidHint, placeholder, presetLabel, value, presets, onChange }) => {
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
          className={cn('min-w-0 flex-1', invalid && 'border-destructive')}
        />
        <div className="w-44 shrink-0">
          <SelectDropdown
            items={items}
            selectedId={null}
            onSelect={(id) => onChange(id === DEFAULT_ITEM_ID ? '' : id)}
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
  const [settings, setSettings] = useMultiplePreferences(BINARY_INSTALL_PREFERENCE_KEYS)
  const [draft, setDraft] = useState(settings)
  const [showToken, setShowToken] = useState(false)
  const tokenId = useId()
  const tokenDescriptionId = useId()

  useEffect(() => {
    if (open) {
      setDraft(settings)
      setShowToken(false)
    }
  }, [open, settings])

  const close = () => {
    setShowToken(false)
    onOpenChange(false)
  }
  const urlsValid = [draft.githubMirror, draft.npmRegistry, draft.pipIndexUrl].every(
    (value) => !value.trim() || isValidUrl(value.trim())
  )

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : close())}>
      <DialogContent>
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
            checked={draft.verifySignatures}
            onCheckedChange={(verifySignatures) => setDraft((current) => ({ ...current, verifySignatures }))}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!urlsValid}
            onClick={() => {
              void setSettings(draft).then(close)
            }}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default EnvironmentDependencies
