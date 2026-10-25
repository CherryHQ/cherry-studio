import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { FileEditSessionContext } from '@renderer/hooks/useFileEditSession'
import { FileEditSessionManager } from '@renderer/services/fileEdit/FileEditSessionManager'
import { toast } from '@renderer/services/toast'

export function FileEditSessionProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => new FileEditSessionManager())
  const retained = useSyncExternalStore(manager.subscribe, manager.getSnapshot)
  const { t } = useTranslation()
  const translate = useRef(t)
  translate.current = t
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
  return (
    <FileEditSessionContext value={manager}>
      {children}
      {retained.length > 0 && (
        <div
          role="alert"
          className="fixed right-4 bottom-4 z-50 max-w-md space-y-2 rounded-lg border border-warning-border bg-warning-subtle p-3 text-warning-subtle-foreground">
          <p className="text-sm">{t('notes.save_failure.description')}</p>
          {retained.map((session) => (
            <div key={session.sessionId} className="space-y-1">
              <p className="break-all text-xs">
                {t(
                  session.ownerId === 'notes'
                    ? 'notes.title'
                    : session.ownerId.startsWith('skill:')
                      ? 'settings.skills.title'
                      : 'agent.right_pane.tabs.files'
                )}
                : {session.locator}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(session.draft)
                      .catch(() => toast.error(translate.current('notes.save_failed')))
                  }>
                  {t('common.copy')}
                </Button>
                <Button
                  size="sm"
                  disabled={session.isSaving}
                  onClick={() =>
                    void manager
                      .recover(session.sessionId, 'retry')
                      .catch(() => toast.error(translate.current('notes.save_failed')))
                  }>
                  {t('common.retry')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={session.isSaving}
                  onClick={() =>
                    void manager
                      .recover(session.sessionId, 'discard')
                      .catch(() => toast.error(translate.current('notes.save_failed')))
                  }>
                  {t('agent.preview_pane.edit.discard')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </FileEditSessionContext>
  )
}
