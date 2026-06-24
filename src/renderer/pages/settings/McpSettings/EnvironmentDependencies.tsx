import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { cn } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import type { BinaryState, ManagedBinary } from '@shared/data/preference/preferenceTypes'
import { type BinaryToolPreset, PRESETS_BINARY_TOOLS, validateManagedBinary } from '@shared/data/presets/binaryTools'
import { useNavigate } from '@tanstack/react-router'
import {
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  SquareArrowOutUpRight,
  Terminal,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('EnvironmentDependencies')

const ToolIcon: FC<{ icon?: string; className?: string }> = ({ icon, className }) => {
  if (icon) {
    return <Icon icon={icon} className={cn('size-5', className)} />
  }
  return <Terminal className={cn('size-5', className)} />
}

type ToolSource = 'managed' | 'bundled' | 'none'

interface EnvironmentDependenciesProps {
  mini?: boolean
}

const EnvironmentDependencies: FC<EnvironmentDependenciesProps> = ({ mini = false }) => {
  const [binaryState, setBinaryState] = useState<BinaryState | null>(null)
  const [bundled, setBundled] = useState<Record<string, string | null>>({})
  const [installingTools, setInstallingTools] = useState<Set<string>>(new Set())
  const [customTools, setCustomTools] = usePreference('feature.binary.tools')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // Retain the last target name so the confirm dialog keeps its message during the close animation.
  const deleteNameRef = useRef('')
  if (deleteTarget) deleteNameRef.current = deleteTarget
  const { t } = useTranslation()
  const navigate = useNavigate()
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshState = useCallback(async () => {
    try {
      const [state, bundledMap] = await Promise.all([
        ipcApi.request('binary.get_state'),
        ipcApi.request('binary.probe_bundled')
      ])
      if (!mountedRef.current) return
      setBinaryState(state)
      setBundled(bundledMap)
    } catch (error) {
      logger.error('Failed to refresh binary state', error as Error)
    }
  }, [])

  useEffect(() => {
    void refreshState()
  }, [refreshState])

  useIpcOn('binary.state_changed', (state) => {
    setBinaryState(state)
    // mise install may shadow a bundled binary; re-probe so the source label stays accurate.
    void ipcApi.request('binary.probe_bundled').then((b) => {
      if (mountedRef.current) setBundled(b)
    })
  })
  useIpcOn('binary.reconcile_failed', (names) => {
    window.toast.error(`${t('settings.plugins.installError')}: ${names}`)
  })

  const installTool = async (tool: ManagedBinary) => {
    setInstallingTools((prev) => new Set(prev).add(tool.name))
    try {
      await ipcApi.request('binary.install_tool', tool)
    } catch (error) {
      logger.error('Failed to install tool', error as Error)
      window.toast.error(`${t('settings.plugins.installError')}: ${formatErrorMessage(error)}`)
      throw error
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
      window.toast.error(t('settings.plugins.invalidTool'))
      throw new Error('invalid')
    }

    const allNames = [...PRESETS_BINARY_TOOLS.map((p) => p.name), ...customTools.map((c) => c.name)]
    if (allNames.includes(tool.name)) {
      window.toast.error(t('settings.plugins.duplicateName'))
      throw new Error('duplicate')
    }

    await installTool(tool)
    await setCustomTools([...customTools, tool])
  }

  const handleRemoveCustomTool = async (toolName: string) => {
    try {
      await ipcApi.request('binary.remove_tool', toolName)
      const updated = customTools.filter((t) => t.name !== toolName)
      await setCustomTools(updated)
      await refreshState()
      setDeleteTarget(null)
    } catch (error) {
      logger.error('Failed to remove tool', error as Error)
      window.toast.error(formatErrorMessage(error))
    }
  }

  const openToolDir = (toolName: string) => {
    void ipcApi.request('binary.get_tool_dir', toolName).then((dir) => window.api.openPath(dir))
  }

  const totalCount = PRESETS_BINARY_TOOLS.length + customTools.length

  if (mini) {
    const uvAvailable = Boolean(binaryState?.tools.uv) || 'uv' in bundled
    const bunAvailable = Boolean(binaryState?.tools.bun) || 'bun' in bundled
    if (uvAvailable && bunAvailable) {
      return null
    }

    return (
      <Button
        className="nodrag h-8 rounded-lg px-2 text-destructive shadow-none hover:text-destructive"
        variant="ghost"
        onClick={() => navigate({ to: '/settings/plugins' })}>
        <TriangleAlert size={14} />
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="font-semibold text-[15px] text-foreground leading-6">{t('settings.plugins.title')}</h1>
          <span className="text-muted-foreground/50 text-xs">{totalCount}</span>
        </div>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{t('settings.plugins.description')}</p>
      </div>

      <div role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PRESETS_BINARY_TOOLS.map((tool) => {
          const installed = binaryState?.tools[tool.name]
          const bundledVersion = bundled[tool.name]
          const source: ToolSource = installed ? 'managed' : tool.name in bundled ? 'bundled' : 'none'
          return (
            <BinaryToolPresetCard
              key={tool.name}
              tool={tool}
              source={source}
              installedVersion={installed?.version ?? bundledVersion ?? undefined}
              installing={installingTools.has(tool.name)}
              onInstall={() => installTool({ name: tool.name, tool: tool.tool, version: tool.version })}
              onUpdate={() => installTool({ name: tool.name, tool: tool.tool })}
              onOpenPath={() => openToolDir(tool.name)}
            />
          )
        })}
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center justify-between">
          <h2 className="font-semibold text-[15px] text-foreground leading-6">{t('settings.plugins.customTools')}</h2>
          <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="size-3.5" />
            {t('settings.plugins.addTool')}
          </Button>
        </div>
      </div>

      {customTools.length > 0 ? (
        <div role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {customTools.map((tool) => {
            const installed = binaryState?.tools[tool.name]
            return (
              <CustomToolCard
                key={tool.name}
                tool={tool}
                installed={!!installed}
                installedVersion={installed?.version}
                installing={installingTools.has(tool.name)}
                onInstall={() => installTool(tool)}
                onUpdate={() => installTool({ name: tool.name, tool: tool.tool })}
                onOpenPath={() => openToolDir(tool.name)}
                onRemove={() => setDeleteTarget(tool.name)}
              />
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-border border-dashed bg-card/50 px-4 py-6 text-center text-muted-foreground text-xs leading-5">
          {t('settings.plugins.customToolsEmpty')}
        </div>
      )}

      <AddToolDialog open={showAddDialog} onOpenChange={setShowAddDialog} onAdd={handleAddCustomTool} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('settings.plugins.removeConfirmTitle')}
        description={t('settings.plugins.removeConfirmMessage', { name: deleteNameRef.current })}
        destructive
        onConfirm={async () => {
          if (deleteTarget) await handleRemoveCustomTool(deleteTarget)
        }}
      />
    </div>
  )
}

const BinaryToolPresetCard: FC<{
  tool: BinaryToolPreset
  source: ToolSource
  installedVersion?: string
  installing: boolean
  onInstall: () => void
  onUpdate: () => void
  onOpenPath: () => void
}> = ({ tool, source, installedVersion, installing, onInstall, onUpdate, onOpenPath }) => {
  const { t } = useTranslation()
  const description = t(`settings.plugins.tools.${tool.name}`)
  const present = source !== 'none'
  const isBundled = source === 'bundled'

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
                {isBundled && (
                  <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] leading-4">
                    {t('settings.plugins.source.bundled')}
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
              title={t('settings.plugins.update')}>
              {installing ? (
                <Loader2 className="size-3.5 motion-safe:animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          </div>
        )}
      </div>

      <p className="mt-2.5 line-clamp-2 text-muted-foreground text-xs leading-4" title={description}>
        {description}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
          onClick={() => void window.api.openWebsite(tool.repoUrl)}>
          <ExternalLink className="size-3" />
          {tool.repoUrl.replace('https://github.com/', '')}
        </button>
        {tool.homepage && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
            onClick={() => void window.api.openWebsite(tool.homepage!)}>
            <SquareArrowOutUpRight className="size-3" />
            {tool.homepage.replace(/^https?:\/\//, '')}
          </button>
        )}
        {present && (
          <button
            type="button"
            onClick={onOpenPath}
            aria-label={t('settings.plugins.openBinariesDir')}
            title={t('settings.plugins.openBinariesDir')}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground">
            <FolderOpen className="size-3" />
          </button>
        )}
      </div>

      {source !== 'managed' && (
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
              ? t('settings.plugins.installing')
              : isBundled
                ? t('settings.plugins.install')
                : t('settings.mcp.install')}
          </Button>
        </div>
      )}
    </div>
  )
}

const CustomToolCard: FC<{
  tool: ManagedBinary
  installed: boolean
  installedVersion?: string
  installing: boolean
  onInstall: () => void
  onUpdate: () => void
  onOpenPath: () => void
  onRemove: () => void
}> = ({ tool, installed, installedVersion, installing, onInstall, onUpdate, onOpenPath, onRemove }) => {
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
            {installed && installedVersion && (
              <Badge variant="secondary" className="mt-0.5 gap-1 px-1.5 py-0 text-[11px] leading-4">
                v{installedVersion}
              </Badge>
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
              title={t('settings.plugins.update')}>
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
              aria-label={t('settings.plugins.openBinariesDir')}
              title={t('common.open')}>
              <FolderOpen className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-foreground/40 hover:text-destructive"
            aria-label={t('settings.plugins.remove')}
            title={t('settings.plugins.remove')}
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
            {installing ? t('settings.plugins.installing') : t('settings.mcp.install')}
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.plugins.addTool')}</DialogTitle>
          <DialogDescription>{t('settings.plugins.addToolDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="relative">
            <Input
              placeholder={t('settings.plugins.searchRegistry')}
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
            {searchError && <p className="mt-1 text-destructive text-xs">{t('settings.plugins.searchFailed')}</p>}
          </div>

          {selectedName && (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <Terminal className="size-4 text-muted-foreground" />
              <span className="font-medium text-sm">{selectedName}</span>
              <span className="text-muted-foreground text-xs">{selectedTool}</span>
            </div>
          )}

          <Input
            placeholder={t('settings.plugins.fieldVersion')}
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

export default EnvironmentDependencies
