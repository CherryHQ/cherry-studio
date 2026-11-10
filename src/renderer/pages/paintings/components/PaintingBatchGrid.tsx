import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import CopyButton from '@renderer/components/CopyButton'

import type { PaintingBatchColumn } from '../model/paintingBatch'
import { getPaintingFileUrl } from '../utils/paintingFileUrl'

interface PaintingBatchGridProps {
  columns: PaintingBatchColumn[]
  onRegenerate: (key: string) => void
  onCancel: (key: string) => void
  onRemove: (key: string) => void
}

const IN_FLIGHT_STATUSES = new Set(['pending', 'generating'])

/** Settings the column actually sent, shown as plain values. */
function summarizeParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ')
}

/**
 * One column per model in a multi-model send. Columns scroll horizontally
 * instead of wrapping, so a column keeps its width at any count.
 */
const PaintingBatchGrid: FC<PaintingBatchGridProps> = ({ columns, onRegenerate, onCancel, onRemove }) => {
  const { t } = useTranslation()

  return (
    <div
      role="list"
      aria-label={t('paintings.batch.grid_label')}
      className="flex h-full w-full gap-3 overflow-x-auto p-3">
      {columns.map((column) => {
        const inFlight = IN_FLIGHT_STATUSES.has(column.status)
        const imageUrl = column.files.map((file) => getPaintingFileUrl(file)).find(Boolean)
        const paramsSummary = summarizeParams(column.request.params)
        return (
          <section
            key={column.key}
            role="listitem"
            data-testid="painting-batch-column"
            className="flex h-full w-72 shrink-0 flex-col gap-2 rounded-lg border border-border-subtle bg-card p-3">
            <header className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{column.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t(`paintings.batch.status.${column.status}`)}
              </span>
            </header>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-background-subtle">
              {imageUrl ? (
                <img src={imageUrl} alt={column.label} className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground">{inFlight ? t('paintings.generating') : null}</span>
              )}
            </div>

            {paramsSummary && <p className="truncate text-xs text-muted-foreground">{paramsSummary}</p>}
            {column.request.referencesIgnored && (
              <p className="text-xs text-muted-foreground">{t('paintings.batch.reference_unsupported')}</p>
            )}
            {column.error && (
              <p role="alert" className="text-xs text-error-subtle-foreground">
                {column.error}
              </p>
            )}

            <footer className="flex flex-wrap items-center gap-1">
              {inFlight ? (
                <Button variant="ghost" size="sm" onClick={() => onCancel(column.key)}>
                  {t('common.cancel')}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => onRegenerate(column.key)}>
                  {column.status === 'failed' ? t('common.retry') : t('common.regenerate')}
                </Button>
              )}
              <CopyButton textToCopy={column.request.prompt} tooltip={t('common.copy')} />
              <Button variant="ghost" size="sm" onClick={() => onRemove(column.key)}>
                {t('common.delete')}
              </Button>
            </footer>
          </section>
        )
      })}
    </div>
  )
}

export default PaintingBatchGrid
