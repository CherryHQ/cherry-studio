import { useCallback, useEffect, useState } from 'react'
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
import { useInvalidateCache } from '@data/hooks/useDataApi'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { formatErrorMessage } from '@renderer/utils/error'
import type { AgentImportSnapshot } from '@shared/ai/agentImport'

type Props = PopupInjectedProps<void>

export function AgentImportDialog({ open, resolve }: Props) {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const navigation = useConversationNavigation('agents')
  const [snapshot, setSnapshot] = useState<AgentImportSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const accept = useCallback((value: AgentImportSnapshot | null) => {
    if (!value) return
    setSnapshot((previous) => (previous?.id === value.id && previous.revision > value.revision ? previous : value))
  }, [])
  useIpcOn('ai.agent.import.progress', (value) => {
    if (value.id !== snapshot?.id) return
    accept(value)
    if (value.status !== 'running') {
      void invalidate('/agents')
      void invalidate('/agent-sessions')
    }
  })
  useEffect(() => {
    let alive = true
    ipcApi
      .request('ai.agent.import.status', {})
      .then((value) => {
        if (!alive) return
        accept(value)
      })
      .catch((cause) => {
        if (alive) setError(formatErrorMessage(cause))
      })
    return () => {
      alive = false
    }
  }, [accept])
  const act = async (action: () => Promise<AgentImportSnapshot | null | void>) => {
    setBusy(true)
    setError('')
    try {
      accept((await action()) ?? null)
    } catch (cause) {
      setError(formatErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const running = snapshot?.status === 'running'
  const completed = snapshot?.status === 'completed'
  const firstSession = snapshot?.sessionIds[0]
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resolve()
      }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('agent.import.title')}</DialogTitle>
          <DialogDescription>{t('agent.import.description')}</DialogDescription>
        </DialogHeader>
        <div aria-live="polite" className="space-y-3">
          {snapshot && (
            <>
              <p>{t('agent.import.summary', { conversations: snapshot.conversations, messages: snapshot.messages })}</p>
              <p>{t('agent.import.progress', snapshot)}</p>
              {completed && <p>{t('common.completed')}</p>}
              {(snapshot.status === 'interrupted' || snapshot.status === 'cancelled') && (
                <p>{t('agent.import.paused')}</p>
              )}
              {snapshot.missingFiles.length > 0 && (
                <div className="text-warning">
                  <p>{t('agent.import.missing')}</p>
                  <ul className="max-h-32 overflow-auto">
                    {snapshot.missingFiles.map((name, index) => (
                      <li key={index}>{name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {(error || snapshot?.error) && (
            <p role="alert" className="break-words text-destructive">
              {error || snapshot?.error}
            </p>
          )}
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={() => resolve()}>
            {t('common.close')}
          </Button>
          {firstSession && (
            <Button
              variant="outline"
              onClick={() => {
                navigation.openConversation(firstSession)
                resolve()
              }}>
              {t('common.open')}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy || running}
            onClick={() => void act(() => ipcApi.request('ai.agent.import.prepare', {}))}>
            {t('common.select')}
          </Button>
          {running && snapshot ? (
            <Button
              disabled={busy}
              onClick={() => void act(() => ipcApi.request('ai.agent.import.cancel', { id: snapshot.id }))}>
              {t('common.stop')}
            </Button>
          ) : (
            snapshot &&
            !completed && (
              <Button
                variant="emphasis"
                loading={busy}
                onClick={() => void act(() => ipcApi.request('ai.agent.import.start', { id: snapshot.id }))}>
                {t(snapshot.status === 'ready' ? 'agent.import.title' : 'common.retry')}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const AgentImportPopup = createPopup<Record<string, never>, void>(AgentImportDialog)
