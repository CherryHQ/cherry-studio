import { CheckCircle2, CircleSlash, Loader2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import type {
  IntegrationAction,
  IntegrationDiagnostic,
  IntegrationOperation
} from '@shared/types/prometheusIntegration'

export function IntegrationOperations({
  operations,
  cancel,
  retry
}: {
  operations: IntegrationOperation[]
  cancel: (id: string) => void
  retry: (operation: IntegrationOperation) => void
}) {
  const { t } = useTranslation()
  if (!operations.length) return null
  const actionLabel: Record<IntegrationAction, string> = {
    pull: t('settings.prometheus.integration.actions.pull'),
    start: t('settings.prometheus.integration.actions.start'),
    stop: t('settings.prometheus.integration.actions.stop'),
    restart: t('settings.prometheus.integration.actions.restart'),
    status: t('settings.prometheus.integration.actions.status'),
    logs: t('settings.prometheus.integration.actions.logs'),
    index: t('settings.prometheus.integration.actions.index'),
    refresh: t('settings.prometheus.integration.actions.refresh'),
    'install-skills': t('settings.prometheus.integration.actions.install-skills'),
    'repair-path': t('settings.prometheus.integration.actions.repair-path'),
    diagnose: t('settings.prometheus.integration.actions.diagnose'),
    'uar-check': t('settings.prometheus.integration.actions.uar-check'),
    'uar-apply': t('settings.prometheus.integration.actions.uar-apply'),
    'uar-restart': t('settings.prometheus.integration.actions.uar-restart'),
    'discover-services': t('settings.prometheus.integration.actions.discover-services')
  }
  const operationState: Record<IntegrationOperation['status'], string> = {
    queued: t('settings.prometheus.integration.states.running'),
    running: t('settings.prometheus.integration.states.running'),
    succeeded: t('settings.prometheus.integration.states.done'),
    failed: t('settings.prometheus.integration.states.failed'),
    cancelled: t('settings.prometheus.integration.states.cancelled'),
    interrupted: t('settings.prometheus.integration.states.failed')
  }
  const diagnosticState: Record<IntegrationDiagnostic['state'], string> = {
    operational: t('settings.prometheus.integration.states.operational'),
    listening: t('settings.prometheus.integration.states.listening'),
    authenticated: t('settings.prometheus.integration.states.authenticated'),
    failed: t('settings.prometheus.integration.states.failed'),
    disabled: t('settings.prometheus.integration.states.disabled')
  }
  const diagnosticLabel: Record<string, string> = {
    'uar.binary': t('settings.prometheus.integration.diagnostic.uar.binary'),
    'uar.capabilities': t('settings.prometheus.integration.diagnostic.uar.capabilities'),
    'uar.process': t('settings.prometheus.integration.diagnostic.uar.process'),
    'uar.storage': t('settings.prometheus.integration.diagnostic.uar.storage')
  }
  return (
    <div className="divide-y divide-border" aria-label={t('settings.prometheus.integration.activity')}>
      {operations.map((operation) => {
        const Icon =
          operation.status === 'queued' || operation.status === 'running'
            ? Loader2
            : operation.status === 'succeeded'
              ? CheckCircle2
              : operation.status === 'cancelled'
                ? CircleSlash
                : XCircle
        return (
          <div key={operation.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm" role="status">
                <Icon
                  size={16}
                  aria-hidden="true"
                  className={
                    operation.status === 'running'
                      ? 'motion-safe:animate-spin'
                      : operation.status === 'failed'
                        ? 'text-error'
                        : ''
                  }
                />
                {actionLabel[operation.action]} · {operationState[operation.status]}
              </span>
              {(operation.status === 'queued' || operation.status === 'running') && (
                <Button variant="outline" size="sm" onClick={() => cancel(operation.id)}>
                  {t('common.cancel')}
                </Button>
              )}
              {(operation.status === 'failed' || operation.status === 'interrupted') && (
                <Button variant="outline" size="sm" onClick={() => retry(operation)}>
                  {t('settings.prometheus.integration.actions.retry')}
                </Button>
              )}
            </div>
            {operation.workspacePath && (
              <p className="mt-1 break-all text-xs text-foreground-secondary">{operation.workspacePath}</p>
            )}
            {operation.error && (
              <p role="alert" className="mt-2 break-words text-sm text-error">
                {t(operation.error, { defaultValue: operation.error })}
              </p>
            )}
            {operation.diagnostics && (
              <dl className="mt-3 space-y-2 text-sm">
                {operation.diagnostics.map((result) => (
                  <div key={result.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                    <dt className="break-all">{diagnosticLabel[result.id] ?? result.id}</dt>
                    <dd className={result.state === 'failed' ? 'text-error' : 'text-foreground-secondary'}>
                      {diagnosticState[result.state]}
                    </dd>
                    {result.detail && (
                      <dd className="col-span-2 break-words text-xs text-error">
                        {t(result.detail, { defaultValue: result.detail })}
                      </dd>
                    )}
                  </div>
                ))}
              </dl>
            )}
            {(operation.status === 'queued' || operation.status === 'running') && operation.output && (
              <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-all text-xs text-foreground-secondary">
                {operation.output}
              </p>
            )}
            {operation.output && (
              <details className="mt-2" open={operation.status === 'queued' || operation.status === 'running'}>
                <summary className="cursor-pointer text-sm text-foreground-secondary focus-visible:outline focus-visible:outline-2">
                  {operation.status === 'queued' || operation.status === 'running'
                    ? t('settings.prometheus.integration.liveOutput')
                    : t('settings.prometheus.integration.output')}
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background-soft p-3 text-xs leading-relaxed select-text">
                  {operation.output}
                </pre>
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}
