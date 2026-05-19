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
import { loggerService } from '@logger'
import { cn } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import type { MiseTool } from '@shared/data/preference/preferenceTypes'
import { useNavigate } from '@tanstack/react-router'
import {
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  PackageCheck,
  Plus,
  SquareArrowOutUpRight,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface EnvironmentDependenciesProps {
  mini?: boolean
}

interface MiseState {
  updatedAt: string
  tools: Record<string, { name: string; tool: string; version: string; installedAt: string }>
}

interface PredefinedTool {
  name: string
  displayName: string
  tool: string
  version?: string
  descriptionKey: string
  repoUrl: string
  homepage?: string
}

const PREDEFINED_TOOLS: PredefinedTool[] = [
  {
    name: 'uv',
    displayName: 'uv',
    tool: 'uv',
    descriptionKey: 'settings.plugins.uvDescription',
    repoUrl: 'https://github.com/astral-sh/uv',
    homepage: 'https://docs.astral.sh/uv/'
  },
  {
    name: 'bun',
    displayName: 'Bun',
    tool: 'bun',
    descriptionKey: 'settings.plugins.bunDescription',
    repoUrl: 'https://github.com/oven-sh/bun',
    homepage: 'https://bun.sh'
  },
  {
    name: 'fd',
    displayName: 'fd',
    tool: 'github:sharkdp/fd',
    version: '10.3.0',
    descriptionKey: 'settings.plugins.fdDescription',
    repoUrl: 'https://github.com/sharkdp/fd'
  },
  {
    name: 'rg',
    displayName: 'ripgrep',
    tool: 'github:BurntSushi/ripgrep',
    version: '15.1.0',
    descriptionKey: 'settings.plugins.rgDescription',
    repoUrl: 'https://github.com/BurntSushi/ripgrep'
  },
  {
    name: 'rtk',
    displayName: 'RTK',
    tool: 'github:rtk-ai/rtk',
    descriptionKey: 'settings.plugins.rtkDescription',
    repoUrl: 'https://github.com/rtk-ai/rtk',
    homepage: 'https://www.runtimekit.com'
  },
  {
    name: 'lark-cli',
    displayName: 'Lark CLI',
    tool: 'github:larksuite/cli',
    descriptionKey: 'settings.plugins.larkCliDescription',
    repoUrl: 'https://github.com/larksuite/cli'
  },
  {
    name: 'gh',
    displayName: 'GitHub CLI',
    tool: 'github:cli/cli',
    descriptionKey: 'settings.plugins.ghDescription',
    repoUrl: 'https://github.com/cli/cli',
    homepage: 'https://cli.github.com'
  }
]

const CORE_DEPS = new Set(['uv', 'bun'])

const logger = loggerService.withContext('EnvironmentDependencies')

const EnvironmentDependencies: FC<EnvironmentDependenciesProps> = ({ mini = false }) => {
  const [miseState, setMiseState] = useState<MiseState | null>(null)
  const [installingTools, setInstallingTools] = useState<Set<string>>(new Set())
  const [binariesDir, setBinariesDir] = useState<string | null>(null)
  const [customTools, setCustomTools] = usePreference('feature.mise.tools')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const { t } = useTranslation()
  const navigate = useNavigate()

  const refreshState = useCallback(async () => {
    try {
      const state = await window.api.mise.getState()
      setMiseState(state)
      const { dir } = await window.api.mcp.getInstallInfo()
      setBinariesDir(dir)
    } catch (error) {
      logger.error('Failed to refresh mise state', error as Error)
    }
  }, [])

  useEffect(() => {
    void refreshState()
  }, [refreshState])

  const installTool = async (tool: MiseTool) => {
    setInstallingTools((prev) => new Set(prev).add(tool.name))
    try {
      await window.api.mise.installTool(tool)
    } catch (error) {
      logger.error('Failed to install tool', error as Error)
      window.toast.error(`${t('settings.mcp.installError')}: ${formatErrorMessage(error)}`)
    } finally {
      setInstallingTools((prev) => {
        const next = new Set(prev)
        next.delete(tool.name)
        return next
      })
      await refreshState()
    }
  }

  const handleAddCustomTool = async (tool: MiseTool) => {
    const allNames = [...PREDEFINED_TOOLS.map((p) => p.name), ...customTools.map((c) => c.name)]
    if (allNames.includes(tool.name)) return

    const updated = [...customTools, tool]
    await setCustomTools(updated)
    await installTool(tool)
  }

  const handleRemoveCustomTool = async (toolName: string) => {
    await window.api.mise.removeTool(toolName)
    const updated = customTools.filter((t) => t.name !== toolName)
    await setCustomTools(updated)
    await refreshState()
    setDeleteTarget(null)
  }

  if (mini) {
    const coreDepsInstalled = [...CORE_DEPS].every((name) => miseState?.tools[name])
    if (coreDepsInstalled) {
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

  const openBinariesDir = () => {
    if (binariesDir) {
      void window.api.openPath(binariesDir)
    }
  }

  const totalCount = PREDEFINED_TOOLS.length + customTools.length

  return (
    <div className="flex flex-col gap-5">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="font-semibold text-[15px] text-foreground leading-6">{t('settings.plugins.title')}</h1>
          <span className="text-muted-foreground/50 text-xs">{totalCount}</span>
        </div>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{t('settings.plugins.description')}</p>
      </div>

      <div className="flex flex-col gap-2">
        {PREDEFINED_TOOLS.map((tool) => {
          const installed = miseState?.tools[tool.name]
          return (
            <PredefinedToolItem
              key={tool.name}
              tool={tool}
              installed={!!installed}
              installedVersion={installed?.version}
              installing={installingTools.has(tool.name)}
              onInstall={() => installTool({ name: tool.name, tool: tool.tool, version: tool.version })}
              onOpenPath={openBinariesDir}
            />
          )
        })}
      </div>

      {customTools.length > 0 && (
        <>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center justify-between">
              <h2 className="font-semibold text-[15px] text-foreground leading-6">
                {t('settings.plugins.customTools')}
              </h2>
              <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
                <Plus className="size-3.5" />
                {t('settings.plugins.addTool')}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {customTools.map((tool) => {
              const installed = miseState?.tools[tool.name]
              return (
                <CustomToolItem
                  key={tool.name}
                  tool={tool}
                  installed={!!installed}
                  installedVersion={installed?.version}
                  installing={installingTools.has(tool.name)}
                  onInstall={() => installTool(tool)}
                  onOpenPath={openBinariesDir}
                  onRemove={() => setDeleteTarget(tool.name)}
                />
              )
            })}
          </div>
        </>
      )}

      {customTools.length === 0 && (
        <div className="flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="size-3.5" />
            {t('settings.plugins.addTool')}
          </Button>
        </div>
      )}

      <AddToolDialog open={showAddDialog} onOpenChange={setShowAddDialog} onAdd={handleAddCustomTool} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('settings.plugins.removeConfirmTitle')}
        description={t('settings.plugins.removeConfirmMessage', { name: deleteTarget })}
        destructive
        onConfirm={() => {
          if (deleteTarget) handleRemoveCustomTool(deleteTarget)
        }}
      />
    </div>
  )
}

const PredefinedToolItem: FC<{
  tool: PredefinedTool
  installed: boolean
  installedVersion?: string
  installing: boolean
  onInstall: () => void
  onOpenPath: () => void
}> = ({ tool, installed, installedVersion, installing, onInstall, onOpenPath }) => {
  const { t } = useTranslation()

  return (
    <div className="group flex w-full items-start gap-3 rounded-lg border border-border/60 bg-transparent px-3 py-2.5 transition-colors duration-200 ease-in-out hover:border-border hover:bg-muted/55">
      <div
        className={cn(
          'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl',
          installed ? 'bg-primary/10 text-primary' : 'bg-blue-500/10 text-blue-500'
        )}>
        <PackageCheck className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-foreground text-sm leading-5">{tool.displayName}</span>
          {tool.displayName !== tool.name && <span className="text-muted-foreground/60 text-xs">({tool.name})</span>}
          {installed && installedVersion && (
            <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[11px] leading-4">
              {installedVersion}
            </Badge>
          )}
        </div>

        <p className="mt-0.5 text-muted-foreground text-xs leading-4">{t(tool.descriptionKey)}</p>

        <div className="mt-1.5 flex items-center gap-3">
          <a
            href={tool.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
            onClick={(e) => {
              e.preventDefault()
              window.api.openWebsite(tool.repoUrl)
            }}>
            <ExternalLink className="size-3" />
            {tool.repoUrl.replace('https://github.com/', '')}
          </a>
          {tool.homepage && (
            <a
              href={tool.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
              onClick={(e) => {
                e.preventDefault()
                window.api.openWebsite(tool.homepage!)
              }}>
              <SquareArrowOutUpRight className="size-3" />
              {tool.homepage.replace(/^https?:\/\//, '')}
            </a>
          )}
          {installed && (
            <button
              type="button"
              onClick={onOpenPath}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground">
              <FolderOpen className="size-3" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-0.5 flex shrink-0 items-center gap-2">
        {installed ? (
          <Badge className="border-transparent bg-success/10 px-1.5 py-0 font-medium text-[11px] text-success leading-4">
            {t('settings.skills.installed')}
          </Badge>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2.5 font-medium text-xs"
            onClick={onInstall}
            disabled={installing}
            loading={installing}>
            {!installing && <Download className="size-3.5" />}
            {installing ? t('settings.plugins.installing') : t('settings.mcp.install')}
          </Button>
        )}
      </div>
    </div>
  )
}

const CustomToolItem: FC<{
  tool: MiseTool
  installed: boolean
  installedVersion?: string
  installing: boolean
  onInstall: () => void
  onOpenPath: () => void
  onRemove: () => void
}> = ({ tool, installed, installedVersion, installing, onInstall, onOpenPath, onRemove }) => {
  const { t } = useTranslation()

  const repoUrl = tool.tool.startsWith('github:') ? `https://github.com/${tool.tool.slice(7)}` : null

  return (
    <div className="group flex w-full items-center gap-3 rounded-lg border border-border/60 bg-transparent px-3 py-2.5 transition-colors duration-200 ease-in-out hover:border-border hover:bg-muted/55">
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          installed ? 'bg-primary/10 text-primary' : 'bg-blue-500/10 text-blue-500'
        )}>
        <PackageCheck className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-foreground text-sm leading-5">{tool.name}</span>
          {installed && installedVersion && (
            <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[11px] leading-4">
              {installedVersion}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{tool.tool}</span>
          {repoUrl && (
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-muted-foreground/70 transition-colors hover:text-foreground"
              onClick={(e) => {
                e.preventDefault()
                window.api.openWebsite(repoUrl)
              }}>
              <ExternalLink className="size-3" />
            </a>
          )}
          {installed && (
            <button
              type="button"
              onClick={onOpenPath}
              className="inline-flex items-center text-muted-foreground/70 transition-colors hover:text-foreground">
              <FolderOpen className="size-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {installed ? (
          <Badge className="border-transparent bg-success/10 px-1.5 py-0 font-medium text-[11px] text-success leading-4">
            {t('settings.skills.installed')}
          </Badge>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2.5 font-medium text-xs"
            onClick={onInstall}
            disabled={installing}
            loading={installing}>
            {!installing && <Download className="size-3.5" />}
            {installing ? t('settings.plugins.installing') : t('settings.mcp.install')}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" className="text-foreground/40 hover:text-destructive" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
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
  onAdd: (tool: MiseTool) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [tool, setTool] = useState('')
  const [version, setVersion] = useState('')
  const [adding, setAdding] = useState(false)

  const reset = () => {
    setName('')
    setTool('')
    setVersion('')
    setAdding(false)
  }

  const handleSubmit = async () => {
    if (!name.trim() || !tool.trim()) return
    setAdding(true)
    try {
      onAdd({ name: name.trim(), tool: tool.trim(), version: version.trim() || undefined })
      reset()
      onOpenChange(false)
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
          <Input placeholder={t('settings.plugins.fieldName')} value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder={t('settings.plugins.fieldTool')} value={tool} onChange={(e) => setTool(e.target.value)} />
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
          <Button onClick={handleSubmit} disabled={!name.trim() || !tool.trim() || adding}>
            {adding && <Loader2 className="size-3.5 animate-spin" />}
            {t('common.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default EnvironmentDependencies
