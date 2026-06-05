import { cn } from '@renderer/utils'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { Folder, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type WorkspaceSelectorProps = {
  session: AgentSessionEntity
}

const WorkspaceSelector = ({ session }: WorkspaceSelectorProps) => {
  const { t } = useTranslation()

  const workspacePath = session.workspace?.path
  // The warning text is produced (and i18n'd) on the main side; the renderer
  // just displays it and does no error interpretation of its own.
  const [workspaceWarning, setWorkspaceWarning] = useState<string | undefined>(undefined)

  useEffect(() => {
    let disposed = false
    setWorkspaceWarning(undefined)
    if (!workspacePath) return

    window.api.file
      .getWorkspacePathWarning(workspacePath)
      .then((warning) => {
        if (!disposed) setWorkspaceWarning(warning ?? undefined)
      })
      .catch(() => {
        // If the check itself fails, leave the warning unset rather than
        // surfacing a synthesized one.
      })

    return () => {
      disposed = true
    }
  }, [workspacePath])

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
