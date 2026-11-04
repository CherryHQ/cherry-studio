import { type ReactNode, use, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { FileEditSessionContext } from '@renderer/hooks/useFileEditSession'
import { FileEditSessionManager, type SessionSnapshot } from '@renderer/services/fileEdit/FileEditSessionManager'
import { toast } from '@renderer/services/toast'

export function FileEditSessionProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => new FileEditSessionManager())
  useEffect(() => {
    const composition = (event: CompositionEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-file-edit]'))
        manager.setComposing(event.type === 'compositionstart')
    }
    document.addEventListener('compositionstart', composition, true)
    document.addEventListener('compositionend', composition, true)
    return () => {
      document.removeEventListener('compositionstart', composition, true)
      document.removeEventListener('compositionend', composition, true)
    }
  }, [manager])
  return <FileEditSessionContext value={manager}>{children}</FileEditSessionContext>
}

export function FileEditRecovery({
  getReopenAction
}: {
  getReopenAction?: (session: SessionSnapshot) => (() => void) | undefined
}) {
  const manager = use(FileEditSessionContext)
  if (!manager) throw new Error('File recovery requires a window session provider')
  const retained = useSyncExternalStore(manager.subscribe, manager.getSnapshot)
  const failures = retained.filter((session) => session.conflict || session.saveError || session.readError)
  const [discardId, setDiscardId] = useState<string>()
  const discarding = retained.find((session) => session.sessionId === discardId)
  const { t } = useTranslation()

  return (
    <>
      {failures.length > 0 && (
        <div className="fixed right-4 bottom-4 z-50 max-w-md space-y-3 rounded-lg border border-warning-border bg-warning-subtle p-3 text-warning-subtle-foreground">
          {failures.map((session) => {
            const reopen = getReopenAction?.(session)
            return (
              <div key={session.sessionId} role="alert" className="space-y-1">
                <p className="break-all text-xs">{session.locator}</p>
                <p className="text-sm">
                  {t(
                    session.conflict ? 'agent.preview_pane.edit.conflict.title' : 'agent.preview_pane.edit.save_failed'
                  )}
                </p>
                <div className="flex gap-2">
                  {reopen && (
                    <Button size="sm" variant="outline" onClick={reopen}>
                      {t('common.open')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard.writeText(session.draft).catch(() => toast.error(t('notes.save_failed')))
                    }>
                    {t('common.copy')}
                  </Button>
                  {!session.conflict && !session.readError && (
                    <Button
                      size="sm"
                      disabled={session.isSaving}
                      onClick={() =>
                        void manager
                          .recover(session.sessionId, 'retry')
                          .catch(() => toast.error(t('notes.save_failed')))
                      }>
                      {t('common.retry')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={session.isSaving}
                    onClick={() => setDiscardId(session.sessionId)}>
                    {t('agent.preview_pane.edit.discard')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ConfirmDialog
        open={!!discarding}
        onOpenChange={(open) => {
          if (!open) setDiscardId(undefined)
        }}
        title={t('file_edit.discard.title')}
        description={t('file_edit.discard.description', { path: discarding?.locator ?? '' })}
        confirmText={t('agent.preview_pane.edit.discard')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={discarding?.isSaving}
        onConfirm={() => {
          if (discarding)
            void manager.recover(discarding.sessionId, 'discard').catch(() => toast.error(t('notes.save_failed')))
        }}
      />
    </>
  )
}
