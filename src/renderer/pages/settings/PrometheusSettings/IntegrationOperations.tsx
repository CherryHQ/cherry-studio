import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { OperationLogViewer, OperationProgress } from '@renderer/components/operation'
import { useIntegrationOperation } from '@renderer/hooks/useIntegrationOperation'
import type {
  IntegrationAction,
  IntegrationOperation,
  IntegrationOperationLogPage
} from '@shared/types/prometheusIntegration'

const LOG_PAGE_BYTES = 65_536

function OperationRow({
  initialOperation,
  retry
}: {
  initialOperation: IntegrationOperation
  retry: (operation: IntegrationOperation) => void
}) {
  const { t } = useTranslation()
  const {
    operation,
    error: replayError,
    cancel,
    readLog,
    exportLog
  } = useIntegrationOperation(initialOperation.id, initialOperation)
  const [logPage, setLogPage] = useState<IntegrationOperationLogPage | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const active = operation?.status === 'queued' || operation?.status === 'running'
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active])

  const loadLog = async (offset: number) => {
    setLogLoading(true)
    try {
      setLogPage(await readLog(offset, LOG_PAGE_BYTES))
      setLogError(null)
    } catch (cause) {
      setLogError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLogLoading(false)
    }
  }

  const showLog = () => {
    const next = !logOpen
    setLogOpen(next)
    if (next && !logPage) void loadLog(0)
  }

  const copyLog = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setLogError(null)
    } catch (cause) {
      setLogError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const saveLog = async () => {
    try {
      await exportLog()
      setLogError(null)
    } catch (cause) {
      setLogError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const actionLabel: Record<IntegrationAction, string> = useMemo(
    () => ({
      pull: t('settings.prometheus.integration.actions.pull'),
      start: t('settings.prometheus.integration.actions.start'),
      stop: t('settings.prometheus.integration.actions.stop'),
      restart: t('settings.prometheus.integration.actions.restart'),
      status: t('settings.prometheus.integration.actions.status'),
      logs: t('settings.prometheus.integration.actions.logs'),
      index: t('settings.prometheus.integration.actions.index'),
      refresh: t('settings.prometheus.integration.actions.refresh'),
      'check-drift': t('settings.prometheus.integration.actions.check-drift'),
      'install-skills': t('settings.prometheus.integration.actions.install-skills'),
      'repair-path': t('settings.prometheus.integration.actions.repair-path'),
      diagnose: t('settings.prometheus.integration.actions.diagnose'),
      'uar-check': t('settings.prometheus.integration.actions.uar-check'),
      'uar-apply': t('settings.prometheus.integration.actions.uar-apply'),
      'uar-restart': t('settings.prometheus.integration.actions.uar-restart'),
      'discover-services': t('settings.prometheus.integration.actions.discover-services')
    }),
    [t]
  )

  if (!operation) return null
  const elapsed = Math.max(0, (operation.completedAt ?? now) - operation.startedAt)
  const elapsedText = t('settings.prometheus.integration.operation.elapsed', {
    seconds: Math.floor(elapsed / 1_000)
  })
  const progressText = operation.progress
    ? t('settings.prometheus.integration.operation.progressCount', {
        current: operation.progress.current,
        total: operation.progress.total,
        unit: operation.progress.unit ?? ''
      })
    : undefined
  const resultText = operation.result
    ? t(operation.result, { defaultValue: operation.result })
    : operation.status === 'succeeded'
      ? t('settings.prometheus.integration.operation.succeeded')
      : undefined
  const operationError = operation.error ? t(operation.error, { defaultValue: operation.error }) : replayError

  return (
    <div className="space-y-3 py-3">
      <OperationProgress
        operation={operation}
        title={actionLabel[operation.action]}
        statusLabel={t(`settings.prometheus.integration.states.${operation.status}`)}
        stageLabel={t(`settings.prometheus.integration.operation.stages.${operation.stage}`)}
        progressLabel={t('settings.prometheus.integration.operation.progress')}
        progressText={progressText}
        elapsedLabel={elapsedText}
        errorText={operationError}
        resultText={resultText}
        recoveryText={
          operation.recoveryAction
            ? t(`settings.prometheus.integration.operation.recovery.${operation.recoveryAction}`)
            : undefined
        }
        labels={{
          cancel: t('common.cancel'),
          retry: t('settings.prometheus.integration.actions.retry'),
          viewLog: t('settings.prometheus.integration.operation.viewLog'),
          tail: t('settings.prometheus.integration.operation.outputTail')
        }}
        onCancel={active ? () => void cancel() : undefined}
        onRetry={
          operation.status === 'failed' || operation.status === 'interrupted' ? () => retry(operation) : undefined
        }
        onViewLog={showLog}
      />
      {operation.workspacePath && (
        <p className="break-all px-1 text-xs text-foreground-secondary">{operation.workspacePath}</p>
      )}
      {logOpen && (
        <div className="rounded-lg border border-border p-4">
          <OperationLogViewer
            page={logPage}
            title={t('settings.prometheus.integration.operation.fullLog')}
            positionLabel={
              logPage
                ? t('settings.prometheus.integration.operation.logPosition', {
                    start: logPage.offset,
                    end: logPage.nextOffset,
                    total: logPage.totalBytes
                  })
                : undefined
            }
            labels={{
              previous: t('common.previous'),
              next: t('common.next'),
              copy: t('common.copy'),
              save: t('common.save'),
              empty: t('settings.prometheus.integration.operation.emptyLog')
            }}
            loading={logLoading}
            onPrevious={
              logPage && logPage.offset > 0
                ? () => void loadLog(Math.max(0, logPage.offset - LOG_PAGE_BYTES))
                : undefined
            }
            onNext={logPage && !logPage.eof ? () => void loadLog(logPage.nextOffset) : undefined}
            onCopy={(text) => void copyLog(text)}
            onSave={() => void saveLog()}
          />
          {logError && (
            <p className="mt-2 break-words text-error text-sm" role="alert">
              {t(logError, { defaultValue: logError })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function IntegrationOperations({
  operations,
  retry
}: {
  operations: IntegrationOperation[]
  retry: (operation: IntegrationOperation) => void
}) {
  const { t } = useTranslation()
  if (!operations.length) return null
  return (
    <div className="divide-y divide-border" aria-label={t('settings.prometheus.integration.activity')}>
      {operations.map((operation) => (
        <OperationRow key={operation.id} initialOperation={operation} retry={retry} />
      ))}
    </div>
  )
}
