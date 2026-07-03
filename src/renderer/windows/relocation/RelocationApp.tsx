/**
 * Root component for the userData relocation window.
 *
 * Renders one of five states driven by the preboot gate's progress
 * payload: preparing → copying (with a progress bar) → committing →
 * completed | failed. Both terminal states surface a restart button
 * (success: "Restart"; failure: "Stay on current directory and restart").
 */
import { Button } from '@cherrystudio/ui'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useRelocationProgress } from './hooks/useRelocationProgress'

const RelocationApp = () => {
  const { t } = useTranslation()
  const { progress, restart } = useRelocationProgress()

  const stage = progress?.stage

  return (
    <div className="flex h-full flex-col items-center bg-background px-8 py-8">
      <div className="flex h-full w-full max-w-[420px] flex-col">
        <h1 className="text-center text-lg font-semibold text-foreground">{t('relocation.title')}</h1>

        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          {!progress && <Loader2 className="animate-spin text-foreground-muted" size={28} />}

          {stage === 'preparing' && <Spinner label={t('relocation.preparing')} />}

          {stage === 'copying' && progress && (
            <Copying label={t('relocation.copying')} copied={progress.bytesCopied} total={progress.bytesTotal} />
          )}

          {stage === 'committing' && <Spinner label={t('relocation.committing')} />}

          {stage === 'completed' && (
            <Terminal
              icon={<CheckCircle2 className="text-success" size={40} />}
              title={t('relocation.completed.title')}
              description={t('relocation.completed.description')}
              buttonLabel={t('relocation.restart')}
              onRestart={restart}
            />
          )}

          {stage === 'failed' && (
            <Terminal
              icon={<XCircle className="text-destructive" size={40} />}
              title={t('relocation.failed.title')}
              description={t('relocation.failed.description')}
              buttonLabel={t('relocation.restart_failure')}
              onRestart={restart}
              error={progress?.error}
            />
          )}
        </div>

        {progress && (
          <Paths fromLabel={t('relocation.from')} toLabel={t('relocation.to')} from={progress.from} to={progress.to} />
        )}
      </div>
    </div>
  )
}

const Spinner = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center gap-3">
    <Loader2 className="animate-spin text-foreground-muted" size={28} />
    <p className="text-sm text-foreground-secondary">{label}</p>
  </div>
)

const Copying = ({ label, copied, total }: { label: string; copied: number; total: number }) => {
  const hasTotal = total > 0
  const percent = hasTotal ? Math.min(100, Math.max(0, Math.round((copied / total) * 100))) : 0

  return (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-3">
      <p className="text-sm text-foreground-secondary">{label}</p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-border">
        {hasTotal ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        )}
      </div>
      <span className="text-foreground-muted text-xs">{hasTotal ? `${percent}%` : ''}</span>
    </div>
  )
}

const Terminal = ({
  icon,
  title,
  description,
  buttonLabel,
  onRestart,
  error
}: {
  icon: React.ReactNode
  title: string
  description: string
  buttonLabel: string
  onRestart: () => void
  error?: string
}) => (
  <div className="flex w-full flex-col items-center gap-3 text-center">
    {icon}
    <h2 className="text-base font-semibold text-foreground">{title}</h2>
    <p className="text-sm text-foreground-secondary">{description}</p>
    {error && (
      <pre className="max-h-24 w-full overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background-subtle px-3 py-2 text-left text-foreground-muted text-xs">
        {error}
      </pre>
    )}
    <Button onClick={onRestart} className="mt-2 w-full">
      {buttonLabel}
    </Button>
  </div>
)

const Paths = ({ fromLabel, toLabel, from, to }: { fromLabel: string; toLabel: string; from: string; to: string }) => (
  <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-xs">
    <PathRow label={fromLabel} value={from} />
    <PathRow label={toLabel} value={to} />
  </div>
)

const PathRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-0.5">
    <span className="font-medium text-foreground-secondary">{label}</span>
    <span className="break-all text-foreground-muted">{value}</span>
  </div>
)

export default RelocationApp
