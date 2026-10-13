import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { workspaceCopyFailureReason } from '@shared/ai/workspaceCopy'
import type { WorkspaceCopyEntity, WorkspaceCopyStatistics } from '@shared/data/api/schemas/agentWorkspaceCopies'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { workspaceCopyErrorCode } from '@shared/ipc/errors/ai'

export function WorkspaceCopiesDialog({ source, onClose }: { source?: AgentWorkspaceEntity; onClose: () => void }) {
  const { t } = useTranslation()
  const { data: copies, refetch, error } = useQuery('/agent-workspace-copies')
  useDataChange('/agent-workspace-copies', () => void refetch())
  const [progress, setProgress] = useState<Record<string, WorkspaceCopyStatistics>>({})
  useIpcOn('ai.agent.workspace.copy.progress', ({ copyId, statistics }) =>
    setProgress((current) => ({ ...current, [copyId]: statistics }))
  )
  const [pending, setPending] = useState<string | null>(null)
  const requestId = useRef(crypto.randomUUID())
  const busy = useRef(false)
  const [storageParent, setStorageParent] = usePreference('agent.workspace_copy.storage_parent', { optimistic: false })

  async function run(key: string, action: () => Promise<unknown>) {
    if (busy.current) return
    busy.current = true
    setPending(key)
    try {
      await action()
      await refetch()
    } catch (error) {
      toast.error(t(`workspace_copy.error.${workspaceCopyFailureReason(workspaceCopyErrorCode(error))}`))
    } finally {
      busy.current = false
      setPending(null)
    }
  }

  async function remove(copy: WorkspaceCopyEntity) {
    if (
      !(await popup.confirm({
        title: t('workspace_copy.delete_files'),
        content: t('workspace_copy.delete_confirmation', { path: copy.path }),
        okText: t('common.delete'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true }
      }))
    )
      return
    await run(copy.id, () =>
      ipcApi.request('ai.agent.workspace.copy.remove', { copyId: copy.id, expectedRevision: copy.revision })
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('workspace_copy.manage')}</DialogTitle>
          <DialogDescription>
            {t('workspace_copy.description')} {t('workspace_copy.kept')} {t('workspace_copy.backup_external')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm">{t('workspace_copy.storage')}</p>
          <p className="break-all text-muted-foreground text-xs">
            {storageParent ?? t('workspace_copy.storage_default')}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={pending !== null}
              onClick={() =>
                void run('storage', async () => {
                  const selected = await window.api.file.selectFolder({
                    properties: ['openDirectory', 'createDirectory']
                  })
                  if (selected) await setStorageParent(selected)
                })
              }>
              {t('workspace_copy.choose_storage')}
            </Button>
            {storageParent ? (
              <Button
                variant="ghost"
                disabled={pending !== null}
                onClick={() => void run('storage', () => setStorageParent(null))}>
                {t('workspace_copy.reset_storage')}
              </Button>
            ) : null}
          </div>
        </div>
        {source ? (
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">{source.name}</span>
            <Button
              disabled={pending !== null}
              onClick={() =>
                void run('create', async () => {
                  await ipcApi.request('ai.agent.workspace.copy.start', {
                    requestId: requestId.current,
                    sourceWorkspaceId: source.id
                  })
                  requestId.current = crypto.randomUUID()
                })
              }>
              {t('workspace_copy.create')}
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {t('workspace_copy.action_failed')}
          </p>
        ) : null}
        <div className="max-h-96 space-y-3 overflow-y-auto" aria-live="polite">
          {copies?.map((copy) => {
            const active = copy.state === 'creating' || copy.state === 'prepared'
            const statistics = active ? progress[copy.id] : copy.statistics
            return (
              <div key={copy.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{copy.name}</span>
                  <span className="text-muted-foreground text-sm">{t(`workspace_copy.state.${copy.state}`)}</span>
                </div>
                <p className="break-all text-muted-foreground text-xs">{copy.path}</p>
                {statistics ? (
                  <p className="text-muted-foreground text-xs">
                    {t('workspace_copy.statistics', { files: statistics.files, cloned: statistics.clonedFiles })}
                  </p>
                ) : null}
                {copy.cleanup !== 'none' ? (
                  <p className="text-warning text-sm">{t('workspace_copy.cleanup_pending')}</p>
                ) : null}
                {copy.storageFallback ? (
                  <p className="text-muted-foreground text-xs">{t('workspace_copy.storage_fallback')}</p>
                ) : null}
                {copy.state === 'failed' || copy.cleanup === 'blocked' ? (
                  <p className="text-destructive text-sm">
                    {t(`workspace_copy.error.${workspaceCopyFailureReason(copy.cleanupReason ?? copy.errorCode)}`)}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  {active ? (
                    <Button
                      variant="outline"
                      disabled={pending !== null}
                      onClick={() =>
                        void run(copy.id, () => ipcApi.request('ai.agent.workspace.copy.cancel', { copyId: copy.id }))
                      }>
                      {t('common.cancel')}
                    </Button>
                  ) : null}
                  {copy.state === 'ready' ? (
                    <Button variant="destructive" disabled={pending !== null} onClick={() => void remove(copy)}>
                      {t('workspace_copy.delete_files')}
                    </Button>
                  ) : null}
                  {copy.cleanup !== 'none' ? (
                    <Button
                      variant="outline"
                      disabled={pending !== null}
                      onClick={() =>
                        void run(copy.id, () =>
                          ipcApi.request('ai.agent.workspace.copy.retry_cleanup', {
                            copyId: copy.id,
                            expectedRevision: copy.revision
                          })
                        )
                      }>
                      {t('workspace_copy.retry_cleanup')}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
