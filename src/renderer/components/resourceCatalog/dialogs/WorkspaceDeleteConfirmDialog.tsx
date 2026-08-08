import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useInvalidateCache, useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentWorkspaceEntity, AgentWorkspaceReferenceItem } from '@shared/data/api/schemas/agentWorkspaces'
import type { LucideIcon } from 'lucide-react'
import { BotMessageSquare, CalendarClock, FolderOpen, Loader2, MousePointerClick, TriangleAlert } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WorkspaceDeleteConfirmDialog')

interface WorkspaceDeleteConfirmDialogProps {
  workspace: AgentWorkspaceEntity
  onDeleted: (workspaceId: string) => void | Promise<void>
  onClose: () => void
}

interface ImpactSectionProps {
  title: string
  countLabel: string
  emptyLabel: string
  items: readonly AgentWorkspaceReferenceItem[]
  icon: LucideIcon
  fallbackName: string
}

function ImpactSection({ title, countLabel, emptyLabel, items, icon: Icon, fallbackName }: ImpactSectionProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-background-subtle">
      <div className="flex h-9 items-center justify-between border-border-subtle border-b px-3">
        <span className="font-medium text-foreground text-xs">{title}</span>
        <span className="text-muted-foreground text-xs">{countLabel}</span>
      </div>
      {items.length > 0 ? (
        <div role="list" aria-label={title} className="max-h-32 overflow-y-auto p-1">
          {items.map((item) => (
            <div key={item.id} role="listitem" className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-xs">
              <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-foreground" title={item.name || undefined}>
                {item.name.trim() || fallbackName}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-3 py-3 text-center text-muted-foreground text-xs">{emptyLabel}</p>
      )}
    </div>
  )
}

export function WorkspaceDeleteConfirmDialog({ workspace, onDeleted, onClose }: WorkspaceDeleteConfirmDialogProps) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const closeConversationTabs = useCloseConversationTabs()
  const invalidateCache = useInvalidateCache()
  const {
    data: references,
    isLoading: areReferencesLoading,
    isRefreshing: areReferencesRefreshing,
    error: referencesError,
    refetch: refetchReferences
  } = useQuery('/agent-workspaces/:workspaceId/references', {
    params: { workspaceId: workspace.id },
    swrOptions: { dedupingInterval: 0 }
  })
  const { trigger: deleteWorkspace } = useMutation('DELETE', '/agent-workspaces/:workspaceId', {
    refresh: ['/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels', '/agent-tasks']
  })

  const previewPending = areReferencesLoading || areReferencesRefreshing
  const canConfirm = references !== undefined && !previewPending && !referencesError && !pending

  const handleConfirm = useCallback(async () => {
    if (!canConfirm || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    let succeeded = false
    try {
      const result = await deleteWorkspace({ params: { workspaceId: workspace.id } })

      closeConversationTabs('agents', result.deletedIds)
      try {
        await invalidateCache(result.deletedIds.map((sessionId) => `/agent-sessions/${sessionId}`))
      } catch (error) {
        logger.warn('Failed to refresh deleted session details', error as Error, {
          workspaceId: workspace.id,
          sessionIds: result.deletedIds
        })
      }
      try {
        await onDeleted(workspace.id)
      } catch (error) {
        logger.warn('Failed to reconcile the deleted workspace selection', error as Error, {
          workspaceId: workspace.id
        })
      }
      toast.success(t('common.delete_success'))
      succeeded = true
    } catch (error) {
      logger.error('Failed to delete workspace', error as Error, { workspaceId: workspace.id })
      toast.error(formatErrorMessageWithPrefix(error, t('agent.session.workdir.delete.error.failed')))
    } finally {
      pendingRef.current = false
      setPending(false)
    }

    if (succeeded) onClose()
  }, [canConfirm, closeConversationTabs, deleteWorkspace, invalidateCache, onClose, onDeleted, t, workspace.id])

  const content = references ? (
    <div className="min-h-0 space-y-3 overflow-y-auto">
      {previewPending ? (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          <span>{t('agent.session.workdir.delete.preview_loading')}</span>
        </div>
      ) : null}
      {referencesError ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-error-subtle px-3 py-2 text-error-subtle-foreground text-xs">
          <span className="flex min-w-0 items-center gap-2">
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {t('agent.session.workdir.delete.preview_failed')}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void refetchReferences()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      <ImpactSection
        title={t('agent.session.workdir.delete.sessions_title')}
        countLabel={t('agent.session.workdir.delete.sessions_count', { count: references.sessions.length })}
        emptyLabel={t('agent.session.workdir.delete.sessions_empty')}
        items={references.sessions}
        icon={MousePointerClick}
        fallbackName={t('agent.session.new')}
      />
      <ImpactSection
        title={t('agent.session.workdir.delete.channels_title')}
        countLabel={t('agent.session.workdir.delete.channels_count', { count: references.channels.length })}
        emptyLabel={t('agent.session.workdir.delete.channels_empty')}
        items={references.channels}
        icon={BotMessageSquare}
        fallbackName={t('common.unnamed')}
      />
      <ImpactSection
        title={t('agent.session.workdir.delete.tasks_title')}
        countLabel={t('agent.session.workdir.delete.tasks_count', { count: references.tasks.length })}
        emptyLabel={t('agent.session.workdir.delete.tasks_empty')}
        items={references.tasks}
        icon={CalendarClock}
        fallbackName={t('agent.session.new')}
      />
      <div className="flex items-start gap-2 rounded-lg bg-background-subtle px-3 py-2 text-muted-foreground text-xs">
        <FolderOpen aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0">
          <p>{t('agent.session.workdir.delete.disk_preserved')}</p>
          <p className="mt-0.5 break-all font-mono text-foreground">{workspace.path}</p>
        </div>
      </div>
    </div>
  ) : (
    <div className="flex min-h-24 items-center justify-center gap-2 text-muted-foreground text-xs">
      {referencesError ? (
        <>
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          <span>{t('agent.session.workdir.delete.preview_failed')}</span>
          <Button variant="ghost" size="sm" onClick={() => void refetchReferences()}>
            {t('common.retry')}
          </Button>
        </>
      ) : (
        <>
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          <span>{t('agent.session.workdir.delete.preview_loading')}</span>
        </>
      )}
    </div>
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pendingRef.current) onClose()
      }}>
      <DialogContent
        motion="fade-scale"
        showCloseButton={false}
        closeOnOverlayClick={!pending}
        className="max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('agent.session.workdir.delete.title')}</DialogTitle>
          <DialogDescription>{t('agent.session.workdir.delete.preview', { name: workspace.name })}</DialogDescription>
        </DialogHeader>
        {content}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" loading={pending} disabled={!canConfirm} onClick={() => void handleConfirm()}>
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
