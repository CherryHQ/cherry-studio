import { cn } from '@renderer/utils'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { WorkspacePathStatus } from '@shared/file/types/ipc'
import { Folder, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type WorkspaceSelectorProps = {
  session: AgentSessionEntity
}

const WorkspaceSelector = ({ session }: WorkspaceSelectorProps) => {
  const { t } = useTranslation()

  const workspacePath = session.workspace?.path
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspacePathStatus | null>(null)

  useEffect(() => {
    let disposed = false
    setWorkspaceStatus(null)
    if (!workspacePath) return

    window.api.file
      .checkWorkspacePath(workspacePath)
      .then((status) => {
        if (!disposed) setWorkspaceStatus(status)
      })
      .catch(() => {
        if (!disposed) setWorkspaceStatus({ ok: false, reason: 'inaccessible' })
      })

    return () => {
      disposed = true
    }
  }, [workspacePath])

  const getWorkspaceStatusMessage = (status: Exclude<WorkspacePathStatus, { ok: true }>) => {
    switch (status.reason) {
      case 'missing':
        return t('agent.session.workspace_status.missing', { path: workspacePath })
      case 'not-directory':
        return t('agent.session.workspace_status.not_directory', { path: workspacePath })
      case 'inaccessible':
        return t('agent.session.workspace_status.inaccessible', { path: workspacePath })
    }
  }

  const workspaceWarning = workspaceStatus?.ok === false ? getWorkspaceStatusMessage(workspaceStatus) : undefined
  const workspaceLabel = session.workspace
    ? session.workspace.name || session.workspace.path
    : t('selector.workspace.placeholder')

  return (
    <div className="ml-2 max-w-60" title={workspaceWarning ?? workspacePath ?? undefined}>
      <div
        className={cn(
          'flex h-7 w-auto max-w-60 items-center gap-1.5 rounded-full px-2 text-xs',
          workspaceWarning ? 'text-warning' : 'text-foreground-500 dark:text-foreground-400'
        )}>
        {workspaceWarning ? (
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 truncate">{workspaceLabel}</span>
      </div>
    </div>
  )
}

export default WorkspaceSelector
