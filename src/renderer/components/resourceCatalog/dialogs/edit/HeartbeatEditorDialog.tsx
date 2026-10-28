import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { hasHeartbeatTasks } from '@shared/ai/agentHeartbeat'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { HeartbeatDocument, HeartbeatRunResult } from '@shared/ipc/schemas/ai'

const logger = loggerService.withContext('HeartbeatEditorDialog')

const runResultKeys: Record<HeartbeatRunResult, string> = {
  started: 'agent.tasks.runTriggered',
  empty: 'agent.heartbeat.empty',
  disabled: 'agent.heartbeat.enable_first',
  busy: 'agent.tasks.logs.running',
  paused: 'agent.heartbeat.paused'
}

export function HeartbeatEditorDialog({
  agentId,
  enabled,
  onOpenChange
}: {
  agentId: string
  enabled: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const inputId = useId()
  const [document, setDocument] = useState<HeartbeatDocument | null>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [runNotice, setRunNotice] = useState<HeartbeatRunResult | null>(null)
  const {
    data: status,
    error: statusError,
    refetch
  } = useQuery('/agents/:agentId/heartbeat', {
    params: { agentId },
    swrOptions: { refreshInterval: 2000, keepPreviousData: false }
  })
  useEffect(() => {
    let cancelled = false
    setDocument(null)
    setError(null)
    void ipcApi
      .request('ai.agent.heartbeat.read', { agentId })
      .then((value) => {
        if (cancelled) return
        setDocument(value)
        setContent(hasHeartbeatTasks(value.content) ? value.content : '')
      })
      .catch((cause) => {
        if (cancelled) return
        logger.warn('Failed to read heartbeat tasks', { cause })
        setError(t('agent.heartbeat.load_failed'))
      })
    return () => {
      cancelled = true
    }
  }, [agentId, reloadKey, t])

  const latest = status?.latestRun
  const running = latest && ['pending', 'delayed', 'running'].includes(latest.status)
  const baseline = document && (hasHeartbeatTasks(document.content) ? document.content : '')
  const dirty = document !== null && content !== baseline
  const result = latest?.output as { result?: string } | undefined

  async function save(run: boolean) {
    if (!document || busy) return
    setBusy(true)
    setError(null)
    setRunNotice(null)
    try {
      if (dirty) {
        const saved = await ipcApi.request('ai.agent.heartbeat.write', { agentId, ...document, content })
        setDocument(saved)
        setContent(hasHeartbeatTasks(saved.content) ? saved.content : '')
      }
      if (run) {
        const outcome = await ipcApi.request('ai.agent.heartbeat.run', { agentId })
        setRunNotice(outcome)
        void refetch()
      } else {
        toast.success(t('common.saved'))
      }
    } catch (cause) {
      logger.warn('Failed to save or run heartbeat tasks', { cause })
      setError(
        t(
          cause instanceof IpcError && cause.code === fileErrorCodes.STALE_VERSION
            ? 'agent.heartbeat.conflict'
            : 'agent.heartbeat.action_failed'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  async function close() {
    if (busy) return
    if (
      dirty &&
      !(await popup.confirm({
        title: t('agent.preview_pane.edit.leave.title'),
        content: t('agent.preview_pane.edit.leave.description'),
        okText: t('agent.preview_pane.edit.leave.discard_and_continue'),
        cancelText: t('common.cancel')
      }))
    )
      return
    onOpenChange(false)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close()
      }}>
      <DialogContent closeOnOverlayClick={false} size="lg" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('agent.heartbeat.edit')}</DialogTitle>
          <DialogDescription>{t('agent.heartbeat.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor={inputId}>{t('agent.heartbeat.tasks')}</Label>
          <Textarea.Input
            id={inputId}
            value={content}
            disabled={!document || busy}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('agent.heartbeat.placeholder')}
            className="min-h-48 resize-y font-mono"
          />
          <p className="text-muted-foreground text-xs">
            {!enabled
              ? t('agent.heartbeat.enable_first')
              : !hasHeartbeatTasks(content)
                ? t('agent.heartbeat.empty')
                : t('agent.heartbeat.saved_next_run')}
          </p>
          {error ? (
            <div role="alert" className="space-y-2 text-destructive text-sm">
              <p>{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setReloadKey((key) => key + 1)}>
                {t('agent.heartbeat.reload')}
              </Button>
            </div>
          ) : null}
          <div className="space-y-1 border-t border-border-subtle pt-3 text-sm" aria-live="polite">
            <p className="font-medium">{t('agent.tasks.lastRun')}</p>
            {statusError ? (
              <p role="alert">{t('agent.tasks.logs.loadError')}</p>
            ) : latest ? (
              <>
                <p>
                  {running ? t('agent.tasks.logs.running') : t(`agent.tasks.logs.${latest.status}`)} ·{' '}
                  {new Date(latest.createdAt).toLocaleString()}
                </p>
                {latest.error ? <p className="text-destructive">{latest.error.message}</p> : null}
                {result?.result ? (
                  <p className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
                    {result.result}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground">{t('agent.tasks.logs.empty')}</p>
            )}
            {enabled && status && !status.scheduleEnabled ? (
              <p className="text-muted-foreground">{t('agent.heartbeat.paused')}</p>
            ) : null}
            {runNotice ? <p role="status">{t(runResultKeys[runNotice])}</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void close()}>
            {t('common.close')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!document || !dirty || busy}
            onClick={() => void save(false)}>
            {t('common.save')}
          </Button>
          <Button
            type="button"
            loading={busy}
            disabled={!document || !enabled || !hasHeartbeatTasks(content) || !!running || busy}
            onClick={() => void save(true)}>
            {t('agent.heartbeat.save_run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
