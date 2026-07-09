import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
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
  NormalTooltip,
  SelectDropdown
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { BinaryInstallSettings, BinaryState, ManagedBinary } from '@shared/data/preference/preferenceTypes'
import {
  GITHUB_MIRROR_PRESETS,
  type InstallSettingPreset,
  NPM_REGISTRY_PRESETS,
  PIP_INDEX_PRESETS
} from '@shared/data/presets/binaryInstallPresets'
import { type BinaryToolPreset, PRESETS_BINARY_TOOLS, validateManagedBinary } from '@shared/data/presets/binaryTools'
import type { CodeCli } from '@shared/types/codeCli'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowBigUp,
  Check,
  Copy,
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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { gt as semverGt, valid as semverValid } from 'semver'

const logger = loggerService.withContext('EnvironmentDependencies')

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

const GroupHeading: FC<{ label: string; count: number }> = ({ label, count }) => (
  <span className="flex items-center gap-2">
    <span className="font-semibold text-foreground">{label}</span>
    <span className="font-normal text-muted-foreground/50 text-xs">{count}</span>
  </span>
)

type ToolSource = 'managed' | 'bundled' | 'system' | 'none'

// Split the preset catalog into the three collapsible UI groups. Runtime deps are
// app-managed (no install action); coding agents get an "open in Code Tools"
// affordance; third-party CLIs sit alongside user-defined custom tools.
const RUNTIME_TOOLS = PRESETS_BINARY_TOOLS.filter((tool) => tool.category === 'runtime')
const AGENT_TOOLS = PRESETS_BINARY_TOOLS.filter((tool) => tool.category === 'agent')
const CLI_PRESET_TOOLS = PRESETS_BINARY_TOOLS.filter((tool) => tool.category === 'cli')

interface EnvironmentDependenciesProps {
  mini?: boolean
}

const EnvironmentDependencies: FC<EnvironmentDependenciesProps> = ({ mini = false }) => {
  const [binaryState, setBinaryState] = useState<BinaryState | null>(null)
  const [binaryStateReady, setBinaryStateReady] = useState(false)
  const [bundled, setBundled] = useState<Record<string, string | null>>({})
  const [systemTools, setSystemTools] = useState<Record<string, string>>({})
  const [latestVersions, setLatestVersions] = useState<Record<string, string> | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [installingTools, setInstallingTools] = useState<Set<string>>(new Set())
  const [customTools, setCustomTools] = usePreference('feature.binary.tools')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showInstallSettings, setShowInstallSettings] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [installError, setInstallError] = useState<{ name: string; message: string } | null>(null)
  // Retain the last target name so the confirm dialog keeps its message during the close animation.
  const deleteNameRef = useRef('')
  if (deleteTarget) deleteNameRef.current = deleteTarget
  const { t } = useTranslation()
  const navigate = useNavigate()
  const mountedRef = useRef(true)
  const latestRequestIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshState = useCallback(async () => {
    try {
      const names = [...PRESETS_BINARY_TOOLS.map((tool) => tool.name), ...customTools.map((tool) => tool.name)]
      const [state, bundledMap, systemMap] = await Promise.all([
        ipcApi.request('binary.get_state'),
        ipcApi.request('binary.probe_bundled'),
        ipcApi.request('binary.probe_system', names)
      ])
      if (!mountedRef.current) return
      setBinaryState(state)
      setBundled(bundledMap)
      setSystemTools(systemMap)
      setBinaryStateReady(true)
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

  useIpcOn('binary.state_changed', (state) => {
    setBinaryState(state)
    setBinaryStateReady(true)
    // Clear all latest-version badges: the managed-tool set changed, so any
    // previously fetched latest-version hints are stale. Next explicit refresh
    // (header button or per-tool Update) will repopulate per-tool results.
    setLatestVersions(null)
    // mise install may shadow a bundled/system binary; re-probe so the source label stays accurate.
    const names = [...PRESETS_BINARY_TOOLS.map((tool) => tool.name), ...customTools.map((tool) => tool.name)]
    void Promise.all([ipcApi.request('binary.probe_bundled'), ipcApi.request('binary.probe_system', names)]).then(
      ([b, s]) => {
        if (!mountedRef.current) return
        setBundled(b)
        setSystemTools(s)
      }
    )
  })
  useIpcOn('binary.reconcile_failed', (names) => {
    toast.error(`${t('settings.dependencies.installError')}: ${names}`)
  })

  // Returns whether the install succeeded so callers can react (e.g. the add flow
  // only persists a custom tool once its install lands) without a floating throw.
  const installTool = async (tool: ManagedBinary): Promise<boolean> => {
    setInstallingTools((prev) => new Set(prev).add(tool.name))
    try {
      await ipcApi.request('binary.install_tool', tool)
      return true
    } catch (error) {
      logger.error('Failed to install tool', error as Error)
      // Surface the full mise error in a persistent, copyable dialog — a toast
      // auto-dismisses before the user can read the multi-line log or copy it.
      setInstallError({ name: tool.name, message: formatErrorMessage(error) })
      return false
    } finally {
      setInstallingTools((prev) => {
        const next = new Set(prev)
        next.delete(tool.name)
        return next
      })
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

    const allNames = [...PRESETS_BINARY_TOOLS.map((p) => p.name), ...customTools.map((c) => c.name)]
    if (allNames.includes(tool.name)) {
      toast.error(t('settings.dependencies.duplicateName'))
      throw new Error('duplicate')
    }

    // Keep the add dialog open (throw) and skip persistence when the install fails.
    if (!(await installTool(tool))) throw new Error('install-failed')
    await setCustomTools([...customTools, tool])
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

  const openToolDir = (toolName: string) => {
    void ipcApi.request('binary.get_tool_dir', toolName).then((dir) => window.api.openPath(dir))
  }

  // Deep-link to the Code Tools launcher with the agent's launch dialog already
  // open — closes the "installed it but don't know how to run it" gap.
  const openInCodeTools = (codeCli: CodeCli) => {
    void navigate({ to: '/app/code', search: { launch: codeCli } })
  }

  const renderPresetCard = (tool: BinaryToolPreset) => {
    const installed = binaryState?.tools[tool.name]
    const bundledVersion = bundled[tool.name]
    const source: ToolSource = installed
      ? 'managed'
      : tool.name in bundled
        ? 'bundled'
        : tool.name in systemTools
          ? 'system'
          : 'none'
    const installedVersion = installed?.version ?? bundledVersion ?? undefined
    const latestVersion = latestVersions?.[tool.name]
    const hasUpdate = !!installed && isNewerVersion(latestVersion, installedVersion)
    const codeCli = tool.codeCli
    return (
      <BinaryToolPresetCard
        key={tool.name}
        tool={tool}
        source={source}
        systemPath={systemTools[tool.name]}
        installedVersion={installedVersion}
        latestVersion={hasUpdate ? latestVersion : undefined}
        installing={installingTools.has(tool.name)}
        onInstall={() => installTool({ name: tool.name, tool: tool.tool, version: tool.version })}
        onUpdate={() => installTool({ name: tool.name, tool: tool.tool })}
        onOpenPath={() => openToolDir(tool.name)}
        onRemove={() => setDeleteTarget(tool.name)}
        onOpen={codeCli && source !== 'none' ? () => openInCodeTools(codeCli) : undefined}
        // Runtime deps are bundled and app-managed — no user install action.
        showInstall={tool.category !== 'runtime'}
      />
    )
  }

  const renderCustomCard = (tool: ManagedBinary) => {
    const installed = binaryState?.tools[tool.name]
    const installedVersion = installed?.version
    const latestVersion = latestVersions?.[tool.name]
    const hasUpdate = !!installed && isNewerVersion(latestVersion, installedVersion)
    return (
      <CustomToolCard
        key={tool.name}
        tool={tool}
        installed={!!installed}
        installedVersion={installedVersion}
        latestVersion={hasUpdate ? latestVersion : undefined}
        installing={installingTools.has(tool.name)}
        onInstall={() => installTool(tool)}
        onUpdate={() => installTool({ name: tool.name, tool: tool.tool })}
        onOpenPath={() => openToolDir(tool.name)}
        onRemove={() => setDeleteTarget(tool.name)}
      />
    )
  }

  const totalCount = PRESETS_BINARY_TOOLS.length + customTools.length

  if (mini) {
    if (!binaryStateReady) {
      return null
    }

    const uvAvailable = Boolean(binaryState?.tools.uv) || 'uv' in bundled
    const bunAvailable = Boolean(binaryState?.tools.bun) || 'bun' in bundled
    if (uvAvailable && bunAvailable) {
      return null
    }

    return (
      <Button
        className="nodrag h-8 rounded-lg px-2 text-destructive shadow-none hover:text-destructive"
        variant="ghost"
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
        </div>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{t('settings.dependencies.description')}</p>
      </div>

      <Accordion type="multiple" defaultValue={['runtime', 'agents', 'cli']} className="min-w-0">
        <AccordionItem value="runtime">
          <AccordionTrigger className="text-[15px] leading-6">
            <GroupHeading label={t('settings.dependencies.runtimeDeps')} count={RUNTIME_TOOLS.length} />
          </AccordionTrigger>
          <AccordionContent>
            <div role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {RUNTIME_TOOLS.map(renderPresetCard)}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="agents">
          <AccordionTrigger className="text-[15px] leading-6">
            <GroupHeading label={t('settings.dependencies.codingAgents')} count={AGENT_TOOLS.length} />
          </AccordionTrigger>
          <AccordionContent>
            <div role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {AGENT_TOOLS.map(renderPresetCard)}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="cli">
          <AccordionTrigger className="text-[15px] leading-6">
            <GroupHeading
              label={t('settings.dependencies.thirdPartyCli')}
              count={CLI_PRESET_TOOLS.length + customTools.length}
            />
          </AccordionTrigger>
          <AccordionContent>
            <div className="mb-3 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
                <Plus className="size-3.5" />
                {t('settings.dependencies.addTool')}
              </Button>
            </div>
            <div role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CLI_PRESET_TOOLS.map(renderPresetCard)}
              {customTools.map(renderCustomCard)}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <AddToolDialog open={showAddDialog} onOpenChange={setShowAddDialog} onAdd={handleAddCustomTool} />

      <InstallSettingsDialog open={showInstallSettings} onOpenChange={setShowInstallSettings} />

      <InstallErrorDialog error={installError} onOpenChange={(open) => !open && setInstallError(null)} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('settings.dependencies.removeConfirmTitle')}
        description={t('settings.dependencies.removeConfirmMessage', { name: deleteNameRef.current })}
        destructive
        onConfirm={async () => {
          if (deleteTarget) await handleRemoveTool(deleteTarget)
        }}
      />
    </div>
  )
}

const BinaryToolPresetCard: FC<{
  tool: BinaryToolPreset
  source: ToolSource
  systemPath?: string
  installedVersion?: string
  latestVersion?: string
  installing: boolean
  onInstall: () => void
  onUpdate: () => void
  onOpenPath: () => void
  onRemove: () => void
  onOpen?: () => void
  showInstall: boolean
}> = ({
  tool,
  source,
  systemPath,
  installedVersion,
  latestVersion,
  installing,
  onInstall,
  onUpdate,
  onOpenPath,
  onRemove,
  onOpen,
  showInstall
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

        {source === 'managed' && (
          <div className="flex shrink-0 items-center gap-1">
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

        {/* Already available (bundled or system): the tool works as-is, so the
            optional mise-managed copy is a low-key icon action, not a CTA that
            would read as "not installed". The tooltip explains why an install
            still shows up for an already-available tool. Runtime deps opt out. */}
        {showInstall && (isBundled || isSystem) && (
          <NormalTooltip content={t('settings.dependencies.installManagedHint')} side="top" align="end">
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-foreground/40 hover:text-foreground"
              onClick={onInstall}
              disabled={installing}
              aria-label={t('settings.dependencies.installManaged')}>
              {installing ? (
                <Loader2 className="size-3.5 motion-safe:animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
            </Button>
          </NormalTooltip>
        )}
      </div>

      <p className="mt-2.5 line-clamp-2 text-muted-foreground text-xs leading-4" title={description}>
        {description}
      </p>

      <div className="mt-3 flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
          onClick={() => void window.api.openWebsite(tool.repoUrl)}>
          <ExternalLink className="size-3 shrink-0" />
          <span className="truncate">{tool.repoUrl.replace('https://github.com/', '')}</span>
        </button>
        {tool.homepage && (
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
            onClick={() => void window.api.openWebsite(tool.homepage!)}>
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

      {/* The bottom bar is reserved for a real action: run an available agent, or
          install a tool that's genuinely missing. Available non-agent tools and
          runtime deps show no bar — their status badges already say everything. */}
      {((showInstall && source === 'none') || onOpen) && (
        <div className="mt-3 flex items-center gap-2 border-border border-t pt-3">
          {onOpen && (
            <Button variant="default" size="sm" className="h-7 flex-1 gap-1 font-medium text-xs" onClick={onOpen}>
              <Terminal className="size-3.5" />
              {t('settings.dependencies.openInCodeTools')}
            </Button>
          )}
          {showInstall && source === 'none' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 flex-1 gap-1 font-medium text-xs"
              onClick={onInstall}
              disabled={installing}
              loading={installing}>
              {!installing && <Download className="size-3.5" />}
              {installing ? t('settings.dependencies.installing') : t('settings.dependencies.install')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

const CustomToolCard: FC<{
  tool: ManagedBinary
  installed: boolean
  installedVersion?: string
  latestVersion?: string
  installing: boolean
  onInstall: () => void
  onUpdate: () => void
  onOpenPath: () => void
  onRemove: () => void
}> = ({ tool, installed, installedVersion, latestVersion, installing, onInstall, onUpdate, onOpenPath, onRemove }) => {
  const { t } = useTranslation()

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
          {installed && (
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
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-foreground/40 hover:text-destructive"
            aria-label={t('settings.dependencies.remove')}
            title={t('settings.dependencies.remove')}
            onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {!installed && (
        <div className="mt-3 border-border border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full gap-1 font-medium text-xs"
            onClick={onInstall}
            disabled={installing}
            loading={installing}>
            {!installing && <Download className="size-3.5" />}
            {installing ? t('settings.dependencies.installing') : t('settings.mcp.install')}
          </Button>
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
    return Boolean(new URL(value))
  } catch {
    return false
  }
}

// Free-text URL field with a preset picker beside it. The full-width Input is the
// source of truth (accepts any value and always shows the actual URL); the picker
// is a fixed-width dropdown that fills the Input on pick. Each preset row shows its
// full address under the label so the user can confirm what they're selecting.
const UrlPresetField: FC<{
  label: string
  description: string
  invalidHint: string
  placeholder: string
  presetLabel: string
  value: string
  presets: InstallSettingPreset[]
  onChange: (value: string) => void
}> = ({ label, description, invalidHint, placeholder, presetLabel, value, presets, onChange }) => {
  const invalid = value.trim() !== '' && !isValidUrl(value.trim())
  const items = presets.map((p) => ({ id: p.url, url: p.url, label: p.label }))

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn('min-w-0 flex-1', invalid && 'border-destructive')}
        />
        <div className="w-44 shrink-0">
          <SelectDropdown
            items={items}
            selectedId={null}
            onSelect={onChange}
            placeholder={presetLabel}
            renderSelected={() => null}
            renderItem={(item) => (
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-foreground text-sm">{item.label}</span>
                <span className="break-all text-muted-foreground text-xs">{item.url}</span>
              </div>
            )}
          />
        </div>
      </div>
      <FieldDescription className={cn(invalid && 'text-destructive')}>
        {invalid ? invalidHint : description}
      </FieldDescription>
    </Field>
  )
}

// Advanced knobs for the mise install path, opened from the header gear icon.
// Writes each field straight to the feature.binary.install_settings preference;
// the main process rebuilds its isolated install env on change (see BinaryManager).
const InstallSettingsDialog: FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({
  open,
  onOpenChange
}) => {
  const { t } = useTranslation()
  const [settings, setSettings] = usePreference('feature.binary.install_settings')
  const [showToken, setShowToken] = useState(false)

  const update = <K extends keyof BinaryInstallSettings>(key: K, val: BinaryInstallSettings[K]) => {
    void setSettings({ ...settings, [key]: val })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            value={settings.githubMirror}
            presets={GITHUB_MIRROR_PRESETS}
            onChange={(v) => update('githubMirror', v)}
          />
          <UrlPresetField
            label={t('settings.dependencies.installSettings.npmRegistry.label')}
            description={t('settings.dependencies.installSettings.npmRegistry.help')}
            invalidHint={t('settings.dependencies.installSettings.invalidUrl')}
            placeholder={t('settings.dependencies.installSettings.npmRegistry.placeholder')}
            presetLabel={t('settings.dependencies.installSettings.presets')}
            value={settings.npmRegistry}
            presets={NPM_REGISTRY_PRESETS}
            onChange={(v) => update('npmRegistry', v)}
          />
          <UrlPresetField
            label={t('settings.dependencies.installSettings.pipIndexUrl.label')}
            description={t('settings.dependencies.installSettings.pipIndexUrl.help')}
            invalidHint={t('settings.dependencies.installSettings.invalidUrl')}
            placeholder={t('settings.dependencies.installSettings.pipIndexUrl.placeholder')}
            presetLabel={t('settings.dependencies.installSettings.presets')}
            value={settings.pipIndexUrl}
            presets={PIP_INDEX_PRESETS}
            onChange={(v) => update('pipIndexUrl', v)}
          />
          <Field>
            <FieldLabel>{t('settings.dependencies.installSettings.githubToken.label')}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                type={showToken ? 'text' : 'password'}
                autoComplete="off"
                placeholder="ghp_…"
                value={settings.githubToken}
                onChange={(e) => update('githubToken', e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => setShowToken((s) => !s)}
                  aria-label={t(
                    showToken
                      ? 'settings.dependencies.installSettings.githubToken.hide'
                      : 'settings.dependencies.installSettings.githubToken.show'
                  )}>
                  {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>{t('settings.dependencies.installSettings.githubToken.help')}</FieldDescription>
          </Field>
          <DescriptionSwitch
            size="sm"
            label={t('settings.dependencies.installSettings.verifySignatures.label')}
            description={t('settings.dependencies.installSettings.verifySignatures.help')}
            checked={settings.verifySignatures}
            onCheckedChange={(checked) => update('verifySignatures', checked)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Install failures carry multi-line mise stderr the user needs to read in full and
// often paste to an AI for help. A toast auto-dismisses before either is possible,
// so surface it in a persistent dialog with the full log selectable and copyable.
const InstallErrorDialog: FC<{
  error: { name: string; message: string } | null
  onOpenChange: (open: boolean) => void
}> = ({ error, onOpenChange }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  // Keep the last error so the text stays put through the close animation.
  const lastRef = useRef<{ name: string; message: string }>({ name: '', message: '' })
  if (error) lastRef.current = error
  const { name, message } = lastRef.current

  const copy = () => {
    void navigator.clipboard.writeText(message).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Dialog open={!!error} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`${t('settings.dependencies.installError')}: ${name}`}</DialogTitle>
          <DialogDescription>{t('settings.dependencies.installErrorHint')}</DialogDescription>
        </DialogHeader>
        <pre className="max-h-72 select-text overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-muted-foreground text-xs leading-5">
          {message}
        </pre>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default EnvironmentDependencies
