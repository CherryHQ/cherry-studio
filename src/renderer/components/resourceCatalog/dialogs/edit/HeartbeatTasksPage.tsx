import { type Ref, useEffect, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import { ErrorNotice } from '@renderer/components/ErrorNotice'
import PromptEditorField from '@renderer/components/PromptEditorField'
import { formatTaskCardTime } from '@renderer/components/ScheduledTask/TaskRunSummaryLine'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { SerializedError } from '@renderer/types/error'
import { providerErrorText } from '@renderer/utils/error'
import { classifyError } from '@renderer/utils/errorClassifier'
import { hasHeartbeatTasks } from '@shared/ai/agentHeartbeat'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { HeartbeatDocument, HeartbeatRunResult } from '@shared/ipc/schemas/ai'
import { extractHttpStatus } from '@shared/utils/errorCategory'

const logger = loggerService.withContext('HeartbeatTasksPage')

type HeartbeatFault = {
  cause: unknown
  summaryKey: string
  operation: 'heartbeat.load' | 'heartbeat.save' | 'heartbeat.run'
}

const runResultKeys: Record<HeartbeatRunResult, string> = {
  started: 'agent.tasks.runTriggered',
  empty: 'agent.heartbeat.empty',
  disabled: 'agent.heartbeat.enable_first',
  busy: 'agent.tasks.logs.running',
  paused: 'agent.heartbeat.paused'
}

/** The job keeps only the thrown text, so recover its cause and the provider's own message from it. */
function describeRunError(message: string) {
  const body = message.indexOf('{')
  const error: SerializedError = {
    name: null,
    message,
    stack: null,
    statusCode: extractHttpStatus(message) ?? null,
    responseBody: body >= 0 ? message.slice(body) : null
  }
  const { category, i18nKey } = classifyError(error)
  return { diagnosisKey: category === 'unknown' ? null : i18nKey, detail: providerErrorText(error) || message }
}

export type HeartbeatTasksPageHandle = {
  /** Resolves false while saving, or when the user keeps an unsaved draft. */
  confirmLeave: () => Promise<boolean>
}

/** The edit dialog's heartbeat tasks page: the heartbeat document, its last run, and save or run. */
export function HeartbeatTasksPage({
  agentId,
  enabled,
  ref
}: {
  agentId: string
  enabled: boolean
  ref?: Ref<HeartbeatTasksPageHandle>
}) {
  const { t } = useTranslation()
  const [document, setDocument] = useState<HeartbeatDocument | null>(null)
  const [content, setContent] = useState('')
  const [fault, setFault] = useState<HeartbeatFault | null>(null)
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
    setContent('')
    setFault(null)
    setRunNotice(null)
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
        setFault({ cause, summaryKey: 'agent.heartbeat.load_failed', operation: 'heartbeat.load' })
      })
    return () => {
      cancelled = true
    }
  }, [agentId, reloadKey])

  const latest = status?.latestRun
  const running = latest && ['pending', 'delayed', 'running'].includes(latest.status)
  const baseline = document && (hasHeartbeatTasks(document.content) ? document.content : '')
  const dirty = document !== null && content !== baseline
  const result = latest?.output as { result?: string } | undefined
  // A cancelled run stores its cancellation reason as an error, so the status picks the summary.
  const runError = latest?.error && latest.status !== 'cancelled' ? describeRunError(latest.error.message) : null
  const latestOutcome =
    latest?.status === 'cancelled'
      ? 'agent.tasks.logs.runCancelled'
      : (runError?.diagnosisKey ?? 'agent.tasks.logs.runFailed')

  useImperativeHandle(ref, () => ({
    confirmLeave: async () => {
      if (busy) return false
      if (!dirty) return true
      return popup.confirm({
        title: t('agent.preview_pane.edit.leave.title'),
        content: t('agent.preview_pane.edit.leave.description'),
        okText: t('agent.preview_pane.edit.leave.discard_and_continue'),
        cancelText: t('common.cancel')
      })
    }
  }))

  async function save(run: boolean) {
    if (!document || busy) return
    setBusy(true)
    setFault(null)
    setRunNotice(null)
    let operation: HeartbeatFault['operation'] = 'heartbeat.save'
    try {
      if (dirty) {
        const saved = await ipcApi.request('ai.agent.heartbeat.write', { agentId, ...document, content })
        setDocument(saved)
        setContent(hasHeartbeatTasks(saved.content) ? saved.content : '')
      }
      if (run) {
        operation = 'heartbeat.run'
        const outcome = await ipcApi.request('ai.agent.heartbeat.run', { agentId })
        setRunNotice(outcome)
        void refetch()
      } else {
        toast.success(t('common.saved'))
      }
    } catch (cause) {
      logger.warn('Failed to save or run heartbeat tasks', { cause })
      setFault({
        cause,
        summaryKey:
          cause instanceof IpcError && cause.code === fileErrorCodes.STALE_VERSION
            ? 'agent.heartbeat.conflict'
            : 'agent.heartbeat.action_failed',
        operation
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">{t('agent.heartbeat.description')}</p>
      {/* The page title already names the field. */}
      <PromptEditorField
        label={null}
        editorLabel={t('agent.heartbeat.tasks')}
        value={content}
        disabled={!document || busy}
        onChange={setContent}
        placeholder={t('agent.heartbeat.placeholder')}
        minHeight="12rem"
      />
      <p className="text-muted-foreground text-xs">
        {!enabled
          ? t('agent.heartbeat.enable_first')
          : !hasHeartbeatTasks(content)
            ? t('agent.heartbeat.empty')
            : t('agent.heartbeat.saved_next_run')}
      </p>
      {fault ? (
        <ErrorNotice
          variant="inline"
          title={t(fault.summaryKey)}
          action={{
            label: t('agent.heartbeat.reload'),
            disabled: busy,
            onClick: () => setReloadKey((key) => key + 1)
          }}
          detail={
            <ErrorDetailAction
              error={fault.cause}
              message={t(fault.summaryKey)}
              source="agent.heartbeat"
              operation={fault.operation}
              recordId={agentId}
            />
          }
        />
      ) : null}
      <div className="space-y-1 border-t border-border-subtle pt-3 text-sm" aria-live="polite">
        <p className="font-medium">{t('agent.tasks.lastRun')}</p>
        {statusError ? (
          <ErrorNotice
            variant="inline"
            title={t('agent.tasks.logs.loadError')}
            detail={
              <ErrorDetailAction
                error={statusError}
                message={t('agent.tasks.logs.loadError')}
                source="agent.heartbeat"
                operation="heartbeat.status"
                recordId={agentId}
              />
            }
          />
        ) : latest ? (
          <>
            <p>
              {running ? t('agent.tasks.logs.running') : t(`agent.tasks.logs.${latest.status}`)} ·{' '}
              {formatTaskCardTime(latest.createdAt)}
            </p>
            {latest.error ? (
              <ErrorNotice
                variant="inline"
                role="group"
                title={t(latestOutcome)}
                detail={
                  <ErrorDetailAction
                    error={latest.error}
                    message={t(latestOutcome)}
                    source="agent.heartbeat"
                    operation="heartbeat.run"
                    recordId={latest.id}
                  />
                }
              />
            ) : null}
            {runError?.diagnosisKey ? (
              <p className="wrap-anywhere text-muted-foreground text-xs">{runError.detail}</p>
            ) : null}
            {result?.result ? (
              <p className="wrap-anywhere max-h-28 overflow-auto whitespace-pre-wrap text-muted-foreground">
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
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" disabled={!document || !dirty || busy} onClick={() => void save(false)}>
          {t('common.save')}
        </Button>
        <Button
          type="button"
          loading={busy}
          disabled={!document || !enabled || !hasHeartbeatTasks(content) || !!running || busy}
          onClick={() => void save(true)}>
          {t('agent.heartbeat.save_run')}
        </Button>
      </div>
    </div>
  )
}
