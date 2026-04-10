import { cn } from '@renderer/utils'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProgressIndicatorProps } from './types'

export const ProgressIndicator: FC<ProgressIndicatorProps> = ({ transferState, handshakeInProgress }) => {
  const { t } = useTranslation()

  const progressPercent = Math.min(100, Math.max(0, transferState.progress ?? 0))

  const progressLabel = (() => {
    if (transferState.status === 'failed') {
      return transferState.error || t('common.unknown_error')
    }
    if (transferState.status === 'selecting') {
      return handshakeInProgress
        ? t('settings.data.export_to_phone.lan.handshake.in_progress')
        : t('settings.data.export_to_phone.lan.status.preparing')
    }
    return `${Math.round(progressPercent)}%`
  })()

  const isFailed = transferState.status === 'failed'
  const isCompleted = transferState.status === 'completed'

  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-1">
      {/* Label Row */}
      <div
        className={cn(
          'flex items-center justify-between gap-1.5 text-[11px]',
          isFailed ? 'text-[var(--color-error)]' : 'text-[var(--color-text-2)]'
        )}>
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{transferState.fileName}</span>
        <span className="shrink-0 whitespace-nowrap">{progressLabel}</span>
      </div>

      {/* Progress Track */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-[120ms]',
            isFailed
              ? 'bg-[var(--color-error)]'
              : isCompleted
                ? 'bg-[var(--color-status-success)]'
                : 'bg-[var(--color-primary)]'
          )}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  )
}
