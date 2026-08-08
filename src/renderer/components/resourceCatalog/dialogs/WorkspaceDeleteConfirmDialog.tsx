import { ConfirmDialog } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { FolderOpen, MousePointerClick } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WorkspaceDeleteConfirmDialog')

interface WorkspaceDeleteConfirmDialogProps {
  workspace: AgentWorkspaceEntity
  sessions: readonly AgentSessionEntity[]
  onClose: () => void
}

export function WorkspaceDeleteConfirmDialog({ workspace, sessions, onClose }: WorkspaceDeleteConfirmDialogProps) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const closeConversationTabs = useCloseConversationTabs()
  const { trigger: deleteWorkspace } = useMutation('DELETE', '/agent-workspaces/:workspaceId', {
    refresh: ['/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']
  })

  const affectedSessions = useMemo(
    () =>
      sessions
        .filter((session) => session.workspaceId === workspace.id)
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sessions, workspace.id]
  )

  const handleConfirm = useCallback(async () => {
    setPending(true)
    try {
      const result = await deleteWorkspace({ params: { workspaceId: workspace.id } })
      closeConversationTabs('agents', result.deletedIds)
      toast.success(t('common.delete_success'))
    } catch (error) {
      logger.error('Failed to delete workspace', error as Error, { workspaceId: workspace.id })
      toast.error(formatErrorMessageWithPrefix(error, t('agent.session.workdir.delete.error.failed')))
      throw error
    } finally {
      setPending(false)
    }
  }, [closeConversationTabs, deleteWorkspace, t, workspace.id])

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
      title={t('agent.session.workdir.delete.title')}
      description={t('agent.session.workdir.delete.preview', { name: workspace.name })}
      content={
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-background-subtle">
            <div className="flex h-9 items-center justify-between border-border-subtle border-b px-3">
              <span className="font-medium text-foreground text-xs">
                {t('agent.session.workdir.delete.sessions_title')}
              </span>
              <span className="text-muted-foreground text-xs">
                {t('agent.session.workdir.delete.sessions_count', { count: affectedSessions.length })}
              </span>
            </div>
            {affectedSessions.length > 0 ? (
              <div
                role="list"
                aria-label={t('agent.session.workdir.delete.sessions_title')}
                className="max-h-48 overflow-y-auto p-1">
                {affectedSessions.map((session) => (
                  <div
                    key={session.id}
                    role="listitem"
                    className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-xs">
                    <MousePointerClick aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate text-foreground" title={session.name || undefined}>
                      {session.name.trim() || t('agent.session.new')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-3 py-4 text-center text-muted-foreground text-xs">
                {t('agent.session.workdir.delete.empty')}
              </p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-background-subtle px-3 py-2 text-muted-foreground text-xs">
            <FolderOpen aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0">
              <p>{t('agent.session.workdir.delete.disk_preserved')}</p>
              <p className="mt-0.5 break-all font-mono text-foreground">{workspace.path}</p>
            </div>
          </div>
        </div>
      }
      confirmText={t('common.delete')}
      cancelText={t('common.cancel')}
      destructive
      confirmLoading={pending}
      contentClassName="sm:max-w-lg"
      onConfirm={handleConfirm}
    />
  )
}
