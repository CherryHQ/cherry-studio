import React from 'react'
import { useTranslation } from 'react-i18next'

interface PlaceholderBlockProps {
  isProcessing: boolean
  createdAt: string
  status?: PlaceholderStatus
}

export type PlaceholderStatus = 'generating' | 'preparing' | 'thinking' | 'usingTools'

const PLACEHOLDER_LABEL_KEYS: Record<PlaceholderStatus, string> = {
  generating: 'message.tools.placeholder.generating',
  preparing: 'message.tools.placeholder.preparing',
  thinking: 'message.tools.placeholder.thinking',
  usingTools: 'message.tools.placeholder.usingTools'
}

type Translate = (key: string, options?: Record<string, number | string>) => string

function getElapsedMs(createdAt: string): number {
  const createdAtMs = Date.parse(createdAt)
  if (!Number.isFinite(createdAtMs)) return 0
  return Math.max(0, Date.now() - createdAtMs)
}

function useElapsedMs(isProcessing: boolean, createdAt: string): number {
  const [elapsedMs, setElapsedMs] = React.useState(() => (isProcessing ? getElapsedMs(createdAt) : 0))

  React.useEffect(() => {
    if (!isProcessing) return

    const updateElapsed = () => setElapsedMs(getElapsedMs(createdAt))
    updateElapsed()

    const timer = setInterval(updateElapsed, 100)
    return () => clearInterval(timer)
  }, [createdAt, isProcessing])

  return elapsedMs
}

export function formatPlaceholderElapsed(elapsedMs: number, t: Translate): string {
  const safeElapsedMs = Math.max(0, Math.floor(elapsedMs))
  const totalTenths = Math.floor(safeElapsedMs / 100)
  const totalSeconds = Math.floor(totalTenths / 10)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = `${totalSeconds % 60}.${totalTenths % 10}`

  if (days > 0) return t('message.tools.placeholder.elapsed.days', { days, hours, minutes, seconds })
  if (hours > 0) return t('message.tools.placeholder.elapsed.hours', { hours, minutes, seconds })
  if (minutes > 0) return t('message.tools.placeholder.elapsed.minutes', { minutes, seconds })
  return t('message.tools.placeholder.elapsed.seconds', { seconds })
}

const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ isProcessing, createdAt, status = 'preparing' }) => {
  const { t } = useTranslation()
  const elapsedMs = useElapsedMs(isProcessing, createdAt)

  if (isProcessing) {
    return (
      <div
        className="-mt-1.25 mb-0.5 flex min-h-6 flex-row items-center gap-1.5 text-[12px] text-muted-foreground/75 leading-4"
        data-testid="message-status-placeholder">
        <span
          className="animation-shimmer motion-reduce:!animate-none"
          data-testid="message-status-text"
          style={
            {
              '--color-shimmer-mid': 'var(--color-foreground-secondary)',
              '--color-shimmer-end': 'color-mix(in srgb, var(--color-foreground-secondary) 35%, transparent)'
            } as React.CSSProperties
          }>
          {t(PLACEHOLDER_LABEL_KEYS[status])}
        </span>
        <span aria-hidden="true" className="text-muted-foreground/40">
          ·
        </span>
        <span className="text-muted-foreground/55" data-testid="message-status-elapsed">
          {formatPlaceholderElapsed(elapsedMs, t)}
        </span>
      </div>
    )
  }
  return null
}
export default React.memo(PlaceholderBlock)
