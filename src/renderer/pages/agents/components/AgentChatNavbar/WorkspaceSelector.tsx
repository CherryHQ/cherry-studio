import { cn } from '@renderer/utils'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type WorkspaceSelectorProps = {
  session: AgentSessionEntity
}

const WorkspaceSelector = ({ session }: WorkspaceSelectorProps) => {
  const { t } = useTranslation()

  const workspacePath = session.workspace?.path

  const workspaceLabel = session.workspace
    ? session.workspace.name || session.workspace.path
    : t('selector.workspace.placeholder')

  return (
    <div className="ml-2 max-w-60" title={workspacePath ?? undefined}>
      <div
        className={cn(
          'flex h-7 w-auto max-w-60 items-center gap-1.5 rounded-full px-2 text-xs',
          'text-foreground-500 dark:text-foreground-400'
        )}>
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{workspaceLabel}</span>
      </div>
    </div>
  )
}

export default WorkspaceSelector
