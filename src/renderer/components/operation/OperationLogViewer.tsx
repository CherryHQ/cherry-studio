import { ChevronLeft, ChevronRight, Copy, Save } from 'lucide-react'
import { type ReactNode, useId } from 'react'

import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { IntegrationOperationLogPage } from '@shared/types/prometheusIntegration'

export interface OperationLogViewerLabels {
  previous: string
  next: string
  copy: string
  save: string
  empty: string
}

export interface OperationLogViewerProps {
  page: IntegrationOperationLogPage | null
  title: ReactNode
  labels: OperationLogViewerLabels
  positionLabel?: ReactNode
  loading?: boolean
  className?: string
  onPrevious?: () => void
  onNext?: () => void
  onCopy?: (text: string) => void
  onSave?: () => void
}

export function OperationLogViewer({
  page,
  title,
  labels,
  positionLabel,
  loading = false,
  className,
  onPrevious,
  onNext,
  onCopy,
  onSave
}: OperationLogViewerProps) {
  const titleId = useId()
  const hasPrevious = Boolean(page && page.offset > 0)
  const hasNext = Boolean(page && !page.eof)

  return (
    <section className={cn('space-y-3', className)} aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={titleId} className="font-medium text-sm">
          {title}
        </h3>
        {positionLabel && <span className="text-muted-foreground text-xs">{positionLabel}</span>}
      </div>

      <div className="rounded-md border border-border bg-background-soft">
        {page?.text ? (
          <pre
            tabIndex={0}
            className="max-h-[min(60vh,36rem)] min-h-48 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed outline-none select-text focus-visible:ring-2 focus-visible:ring-ring">
            {page.text}
          </pre>
        ) : (
          <div className="flex min-h-48 items-center justify-center p-4 text-muted-foreground text-sm" role="status">
            {labels.empty}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || !hasPrevious || !onPrevious}
            onClick={onPrevious}>
            <ChevronLeft className="size-4" aria-hidden />
            {labels.previous}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={loading || !hasNext || !onNext} onClick={onNext}>
            {labels.next}
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading || !page?.text || !onCopy}
            onClick={() => page?.text && onCopy?.(page.text)}>
            <Copy className="size-4" aria-hidden />
            {labels.copy}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={loading || !page || !onSave} onClick={onSave}>
            <Save className="size-4" aria-hidden />
            {labels.save}
          </Button>
        </div>
      </div>
    </section>
  )
}
