import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('AgentWorkspaceUnavailableNotice')

interface Props {
  workspacePath: string
  onWorkspaceChange: (workspaceId: string) => void | Promise<void>
}

export function AgentWorkspaceUnavailableNotice({ workspacePath, onWorkspaceChange }: Props) {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const [choosing, setChoosing] = useState(false)

  const handleChoose = async () => {
    setChoosing(true)
    try {
      const folderPath = await window.api.file.selectFolder({ properties: ['openDirectory', 'createDirectory'] })
      if (!folderPath) return
      const workspace = await ipcApi.request('ai.agent.workspace.register', {
        path: AbsoluteFilePathSchema.parse(folderPath)
      })
      await invalidate('/agent-workspaces')
      await onWorkspaceChange(workspace.id)
    } catch (error) {
      logger.error('Failed to choose replacement workspace', error as Error, { workspacePath })
      toast.error(t('agent.session.workspace_selector.create_failed'))
    } finally {
      setChoosing(false)
    }
  }

  return (
    <div
      role="alert"
      className="mb-2 flex w-full items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="font-medium text-foreground text-sm">{t('agent.session.workspace_unavailable.title')}</div>
        <div className="text-muted-foreground text-xs">{t('agent.session.workspace_unavailable.description')}</div>
        <div className="truncate font-mono text-muted-foreground text-xs" title={workspacePath}>
          {t('agent.session.workspace_unavailable.path', { path: workspacePath })}
        </div>
      </div>
      <Button size="sm" onClick={() => void handleChoose()} disabled={choosing}>
        {t('agent.session.workspace_unavailable.choose')}
      </Button>
    </div>
  )
}
