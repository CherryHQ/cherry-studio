import { CheckCircle2, CircleSlash, Loader2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@cherrystudio/ui'
import type { IntegrationOperation } from '@shared/types/prometheusIntegration'

export function IntegrationOperations({ operations, cancel }: { operations: IntegrationOperation[]; cancel: (id: string) => void }) {
  const { t } = useTranslation()
  if (!operations.length) return null
  return <div className="mt-5 divide-y divide-border" aria-label={t('settings.prometheus.integration.activity')}>
    {operations.map((operation) => {
      const Icon = operation.status === 'running' ? Loader2 : operation.status === 'done' ? CheckCircle2 : operation.status === 'cancelled' ? CircleSlash : XCircle
      return <div key={operation.id} className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-sm" role="status">
            <Icon size={16} aria-hidden="true" className={operation.status === 'running' ? 'motion-safe:animate-spin' : operation.status === 'failed' ? 'text-error' : ''} />
            {t(`settings.prometheus.integration.actions.${operation.action}`)} · {t(`settings.prometheus.integration.states.${operation.status}`)}
          </span>
          {operation.status === 'running' && <Button variant="outline" size="sm" onClick={() => cancel(operation.id)}>{t('common.cancel')}</Button>}
        </div>
        {operation.workspacePath && <p className="mt-1 break-all text-xs text-foreground-secondary">{operation.workspacePath}</p>}
        {operation.error && <p role="alert" className="mt-2 break-words text-sm text-error">{t(operation.error, { defaultValue: operation.error })}</p>}
        {operation.diagnostics && <dl className="mt-3 space-y-2 text-sm">
          {operation.diagnostics.map((result) => <div key={result.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
            <dt className="break-all">{result.id}</dt>
            <dd className={result.state === 'failed' ? 'text-error' : 'text-foreground-secondary'}>{t(`settings.prometheus.integration.states.${result.state}`)}</dd>
            {result.detail && <dd className="col-span-2 break-words text-xs text-error">{t(result.detail, { defaultValue: result.detail })}</dd>}
          </div>)}
        </dl>}
        {operation.output && <details className="mt-2">
          <summary className="cursor-pointer text-sm text-foreground-secondary focus-visible:outline focus-visible:outline-2">{t('settings.prometheus.integration.output')}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background-soft p-3 text-xs leading-relaxed select-text">{operation.output}</pre>
        </details>}
      </div>
    })}
  </div>
}
