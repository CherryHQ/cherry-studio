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
import { Download, FolderOpen, Loader2, PackageCheck, Plus, Trash2, TriangleAlert } from 'lucide-react'
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
  tool: string
  version?: string
  descriptionKey: string
}

const PREDEFINED_TOOLS: PredefinedTool[] = [
  { name: 'uv', tool: 'uv', descriptionKey: 'settings.plugins.uvDescription' },
  { name: 'bun', tool: 'bun', descriptionKey: 'settings.plugins.bunDescription' },
  { name: 'fd', tool: 'github:sharkdp/fd', version: '10.3.0', descriptionKey: 'settings.plugins.fdDescription' },
  {
    name: 'rg',
    tool: 'github:BurntSushi/ripgrep',
    version: '15.1.0',
    descriptionKey: 'settings.plugins.rgDescription'
  },
  { name: 'rtk', tool: 'github:rtk-ai/rtk', descriptionKey: 'settings.plugins.rtkDescription' },
  { name: 'lark-cli', tool: 'github:larksuite/cli', descriptionKey: 'settings.plugins.larkCliDescription' },
  { name: 'gh', tool: 'github:cli/cli', descriptionKey: 'settings.plugins.ghDescription' }
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
            <ToolItem
              key={tool.name}
              name={tool.name}
              description={t(tool.descriptionKey)}
              installed={!!installed}
              installedVersion={installed?.version}
              installing={installingTools.has(tool.name)}
              onInstall={() => installTool({ name: tool.name, tool: tool.tool, version: tool.version })}
              onOpenPath={openBinariesDir}
              actionLabel={t('settings.mcp.install')}
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
                <ToolItem
                  key={tool.name}
                  name={tool.name}
                  description={tool.tool}
                  installed={!!installed}
                  installedVersion={installed?.version}
                  installing={installingTools.has(tool.name)}
                  onInstall={() => installTool(tool)}
                  onOpenPath={openBinariesDir}
                  actionLabel={t('settings.mcp.install')}
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

const ToolItem: FC<{
  actionLabel: string
  description: string
  installed: boolean
  installedVersion?: string
  installing: boolean
  name: string
  onInstall: () => void
  onOpenPath: () => void
  onRemove?: () => void
}> = ({ actionLabel, description, installed, installedVersion, installing, name, onInstall, onOpenPath, onRemove }) => {
  const { t } = useTranslation()

  return (
    <div className="group flex min-h-13 w-full items-center gap-2.5 rounded-lg border border-border/60 bg-transparent px-2.5 py-2 transition-colors duration-200 ease-in-out hover:border-border hover:bg-muted/55">
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          installed ? 'bg-primary/10 text-primary' : 'bg-blue-500/10 text-blue-500'
        )}>
        <PackageCheck className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="truncate font-medium text-foreground text-sm leading-5">{name}</div>
          {installed && installedVersion && (
            <span className="text-muted-foreground/50 text-xs">{installedVersion}</span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs leading-4">
          <span className="truncate">{description}</span>
          <button
            type="button"
            onClick={onOpenPath}
            disabled={!installed}
            aria-label={t('settings.skills.directory')}
            className={cn(
              'inline-flex size-4.5 shrink-0 items-center justify-center rounded-md transition-colors',
              installed ? 'text-muted-foreground/55 hover:bg-background hover:text-foreground' : 'hidden'
            )}>
            <FolderOpen className="size-3" />
          </button>
        </div>
      </div>

      <div className="flex min-w-[92px] shrink-0 items-center justify-end gap-2">
        {installed ? (
          <Badge className="border-transparent bg-success/10 px-1.5 py-0 font-medium text-[11px] text-success leading-4">
            {t('settings.skills.installed')}
          </Badge>
        ) : (
          <>
            <Badge className="border-transparent bg-muted px-1.5 py-0 font-medium text-[11px] text-muted-foreground leading-4">
              {t('settings.plugins.notInstalled')}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 font-medium text-xs shadow-none"
              onClick={onInstall}
              disabled={installing}
              loading={installing}>
              {!installing && <Download className="size-3.5" />}
              {installing ? t('settings.plugins.installing') : actionLabel}
            </Button>
          </>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-foreground/40 hover:text-destructive"
            onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
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
