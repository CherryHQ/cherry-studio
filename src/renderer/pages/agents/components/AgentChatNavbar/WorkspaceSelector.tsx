import { SelectDropdown } from '@cherrystudio/ui'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useUpdateSession } from '@renderer/hooks/agents/useSession'
import { cn } from '@renderer/utils'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { WorkspaceEntity } from '@shared/data/api/schemas/workspaces'
import type { WorkspacePathStatus } from '@shared/file/types/ipc'
import { Folder, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type WorkspaceSelectorProps = {
  session: AgentSessionEntity
}

const WorkspaceSelector = ({ session }: WorkspaceSelectorProps) => {
  const { t } = useTranslation()
  const { data: workspaces } = useQuery('/workspaces')
  const { updateSession } = useUpdateSession(session.agentId)

  const workspacePath = session.workspace?.path
  const workspaceItems = useMemo(() => {
    const items = workspaces ?? []
    if (!session.workspace || items.some((workspace) => workspace.id === session.workspaceId)) return items
    return [session.workspace, ...items]
  }, [session.workspace, session.workspaceId, workspaces])
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

  const handleSelectWorkspace = (workspaceId: string) => {
    if (workspaceId === session.workspaceId) return
    void updateSession({ id: session.id, workspaceId }, { showSuccessToast: false })
  }

  const renderWorkspaceLabel = (workspace: WorkspaceEntity) => (
    <span className="min-w-0 truncate">{workspace.name || workspace.path}</span>
  )

  const renderWorkspaceItem = (workspace: WorkspaceEntity) => (
    <div className="flex min-w-0 items-center gap-2">
      <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate">{workspace.name || workspace.path}</span>
        <span className="truncate text-muted-foreground/55 text-xs">{workspace.path}</span>
      </div>
    </div>
  )

  return (
    <div className="ml-2 max-w-60" title={workspaceWarning ?? workspacePath ?? undefined}>
      <SelectDropdown
        items={workspaceItems}
        selectedId={session.workspaceId}
        onSelect={handleSelectWorkspace}
        renderTriggerLeading={
          workspaceWarning ? (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        }
        renderSelected={renderWorkspaceLabel}
        renderItem={renderWorkspaceItem}
        placeholder={t('selector.workspace.placeholder')}
        emptyText={t('selector.workspace.empty_text')}
        triggerClassName={cn(
          'h-7 w-auto max-w-60 rounded-full border-0 bg-transparent px-2 text-xs shadow-none',
          workspaceWarning
            ? 'text-warning hover:bg-transparent hover:text-warning'
            : 'text-foreground-500 hover:bg-accent/30 hover:text-primary dark:text-foreground-400'
        )}
      />
    </div>
  )
}

export default WorkspaceSelector
