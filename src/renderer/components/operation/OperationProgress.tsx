import { AlertCircle, Ban, CheckCircle2, CircleDot, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Alert, Badge, Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { IntegrationOperation, IntegrationOperationStatus } from '@shared/types/prometheusIntegration'

const statusStyles: Record<IntegrationOperationStatus, string> = {
  queued: 'border-info-border bg-info-subtle text-info-subtle-foreground',
  running: 'border-info-border bg-info-subtle text-info-subtle-foreground',
  succeeded: 'border-success-border bg-success-subtle text-success-subtle-foreground',
  failed: 'border-error-border bg-error-subtle text-error-subtle-foreground',
  cancelled: 'border-border bg-muted text-muted-foreground',
  interrupted: 'border-warning-border bg-warning-subtle text-warning-subtle-foreground'
}

function StatusIcon({ status }: { status: IntegrationOperationStatus }) {
  if (status === 'running') return <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
  if (status === 'succeeded') return <CheckCircle2 className="size-4" aria-hidden />
  if (status === 'failed' || status === 'interrupted') return <AlertCircle className="size-4" aria-hidden />
  if (status === 'cancelled') return <Ban className="size-4" aria-hidden />
  return <CircleDot className="size-4" aria-hidden />
}

export interface OperationProgressLabels {
  cancel: string
  retry: string
  viewLog: string
  tail: string
}

export interface OperationProgressProps {
  operation: IntegrationOperation
  title: ReactNode
  statusLabel: ReactNode
  stageLabel: ReactNode
  progressLabel: string
  progressText?: ReactNode
  elapsedLabel?: ReactNode
  errorText?: ReactNode
  resultText?: ReactNode
  recoveryText?: ReactNode
  labels: OperationProgressLabels
  className?: string
  onCancel?: () => void
  recoveryAction?: { label: string; onClick: () => void }
  onRetry?: () => void
  onViewLog?: () => void
}

export function OperationProgress({
  operation,
  title,
  statusLabel,
  stageLabel,
  progressLabel,
  progressText,
  elapsedLabel,
  errorText,
  resultText,
  recoveryText,
  labels,
  className,
  onCancel,
  recoveryAction,
  onRetry,
  onViewLog
}: OperationProgressProps) {
  const active = operation.status === 'queued' || operation.status === 'running'
  const progress = operation.progress
  const progressValue =
    progress && progress.total > 0 ? Math.min(progress.current / progress.total, 1) * 100 : undefined

  return (
    <section
      className={cn('space-y-3 rounded-lg border border-border p-4', className)}
      aria-labelledby={`${operation.id}-title`}>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {title}: {statusLabel}. {stageLabel}
      </span>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id={`${operation.id}-title`} className="break-words font-medium text-sm">
            {title}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <span>{stageLabel}</span>
            {elapsedLabel && <span>{elapsedLabel}</span>}
          </div>
        </div>
        <Badge variant="outline" className={cn('gap-1.5', statusStyles[operation.status])}>
          <StatusIcon status={operation.status} />
          {statusLabel}
        </Badge>
      </div>

      {active && (
        <div className="space-y-1.5">
          <div
            role="progressbar"
            aria-label={progressLabel}
            aria-valuemin={progressValue === undefined ? undefined : 0}
            aria-valuemax={progressValue === undefined ? undefined : 100}
            aria-valuenow={progressValue === undefined ? undefined : Math.round(progressValue)}
            className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full bg-primary transition-[width]',
                progressValue === undefined && 'w-1/3 motion-safe:animate-pulse'
              )}
              style={progressValue === undefined ? undefined : { width: `${progressValue}%` }}
            />
          </div>
          {progressText && <div className="text-muted-foreground text-xs">{progressText}</div>}
        </div>
      )}

      {errorText && (
        <Alert type="error" showIcon message={errorText} description={recoveryText} role="alert" aria-atomic="true" />
      )}
      {!errorText && resultText && (
        <Alert
          type={operation.status === 'succeeded' ? 'success' : 'info'}
          showIcon
          message={resultText}
          description={recoveryText}
          role="status"
          aria-atomic="true"
        />
      )}

      {operation.output && (
        <details>
          <summary className="cursor-pointer text-muted-foreground text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            {labels.tail}
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background-soft p-3 font-mono text-xs leading-relaxed select-text">
            {operation.output}
          </pre>
        </details>
      )}

      {(onCancel || recoveryAction || onRetry || onViewLog) && (
        <div className="flex flex-wrap gap-2">
          {active && onCancel && (
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              {labels.cancel}
            </Button>
          )}
          {(operation.status === 'failed' || operation.status === 'interrupted') && onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {labels.retry}
            </Button>
          )}
          {recoveryAction && (
            <Button type="button" variant="outline" size="sm" onClick={recoveryAction.onClick}>
              {recoveryAction.label}
            </Button>
          )}
          {onViewLog && (
            <Button type="button" variant="ghost" size="sm" onClick={onViewLog}>
              {labels.viewLog}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
