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
  EmptyState,
  Input
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { MiseTool } from '@shared/data/preference/preferenceTypes'
import { Check, Loader2, Package, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingContainer,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  settingsContentBodyClassName,
  settingsContentScrollClassName,
  SettingTitle
} from '.'

interface MiseState {
  updatedAt: string
  tools: Record<string, { name: string; tool: string; version: string; installedAt: string }>
}

const ToolManagerSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [tools, setTools] = usePreference('feature.mise.tools')
  const [miseState, setMiseState] = useState<MiseState | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const refreshState = useCallback(async () => {
    const state = await window.api.mise.getState()
    setMiseState(state)
  }, [])

  useEffect(() => {
    refreshState()
  }, [refreshState])

  const handleReconcile = async () => {
    setReconciling(true)
    try {
      await window.api.mise.reconcile()
      await refreshState()
    } finally {
      setReconciling(false)
    }
  }

  const handleAddTool = async (tool: MiseTool) => {
    const exists = tools.some((t) => t.name === tool.name)
    if (exists) return

    const updated = [...tools, tool]
    await setTools(updated)

    try {
      await window.api.mise.installTool(tool)
    } finally {
      await refreshState()
    }
  }

  const handleRemoveTool = async (toolName: string) => {
    await window.api.mise.removeTool(toolName)
    const updated = tools.filter((t) => t.name !== toolName)
    await setTools(updated)
    await refreshState()
    setDeleteTarget(null)
  }

  return (
    <Scrollbar className={settingsContentScrollClassName}>
      <SettingContainer theme={theme} className={settingsContentBodyClassName}>
        <SettingGroup theme={theme}>
          <SettingTitle>
            <span>{t('settings.tool_manager.title')}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleReconcile} disabled={reconciling}>
                {reconciling ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {t('settings.tool_manager.reconcile')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
                <Plus className="size-3.5" />
                {t('settings.tool_manager.add_tool')}
              </Button>
            </div>
          </SettingTitle>
        </SettingGroup>

        <SettingGroup theme={theme}>
          {tools.length === 0 ? (
            <EmptyState description={t('settings.tool_manager.empty')} />
          ) : (
            <div className="flex flex-col gap-2">
              {tools.map((tool) => {
                const installed = miseState?.tools[tool.name]
                return (
                  <SettingRow key={tool.name} className="rounded-lg border border-border/60 px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Package className="size-4 text-foreground/50" />
                      <div className="flex flex-col gap-0.5">
                        <SettingRowTitle className="font-semibold">{tool.name}</SettingRowTitle>
                        <span className="text-foreground-muted text-xs">{tool.tool}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {installed ? (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <Check className="size-3" />
                          {installed.version}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          {tool.version || 'latest'}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-foreground/40 hover:text-destructive"
                        onClick={() => setDeleteTarget(tool.name)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </SettingRow>
                )
              })}
            </div>
          )}
        </SettingGroup>
      </SettingContainer>

      <AddToolDialog open={showAddDialog} onOpenChange={setShowAddDialog} onAdd={handleAddTool} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('settings.tool_manager.remove_confirm_title')}
        description={t('settings.tool_manager.remove_confirm_message', { name: deleteTarget })}
        destructive
        onConfirm={() => {
          if (deleteTarget) handleRemoveTool(deleteTarget)
        }}
      />
    </Scrollbar>
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
          <DialogTitle>{t('settings.tool_manager.add_tool')}</DialogTitle>
          <DialogDescription>{t('settings.tool_manager.add_tool_description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Input
            placeholder={t('settings.tool_manager.field_name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder={t('settings.tool_manager.field_tool')}
            value={tool}
            onChange={(e) => setTool(e.target.value)}
          />
          <Input
            placeholder={t('settings.tool_manager.field_version')}
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

export default ToolManagerSettings
