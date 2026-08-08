import type { StallReason } from '@shared/ai/transport'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { BeatLoader } from 'react-spinners'

interface PlaceholderBlockProps {
  isProcessing: boolean
  createdAt: string
  status?: PlaceholderStatus
  stalled?: boolean
  stalledReason?: StallReason
}

export type PlaceholderStatus = 'generating' | 'preparing' | 'thinking' | 'usingTools'

const PLACEHOLDER_LABEL_KEYS: Record<PlaceholderStatus, string> = {
  generating: 'message.tools.placeholder.generating',
  preparing: 'message.tools.placeholder.preparing',
  thinking: 'message.tools.placeholder.thinking',
  usingTools: 'message.tools.placeholder.usingTools'
}

const STALL_LABEL_KEYS: Record<StallReason, string> = {
  tool_stall: 'message.tools.placeholder.stalled.tool',
  no_progress: 'message.tools.placeholder.stalled.no_progress'
}

type Translate = (key: string, options?: Record<string, number | string>) => string

function getElapsedMs(createdAt: string): number {
  const createdAtMs = Date.parse(createdAt)
  if (!Number.isFinite(createdAtMs)) return 0
  return Math.max(0, Date.now() - createdAtMs)
}

export function usePlaceholderElapsedMs(isProcessing: boolean, createdAt: string, updateIntervalMs = 100): number {
  const [elapsedMs, setElapsedMs] = React.useState(() => (isProcessing ? getElapsedMs(createdAt) : 0))

  React.useEffect(() => {
    if (!isProcessing) return

    const updateElapsed = () => setElapsedMs(getElapsedMs(createdAt))
    updateElapsed()

    const timer = setInterval(updateElapsed, updateIntervalMs)
    return () => clearInterval(timer)
  }, [createdAt, isProcessing, updateIntervalMs])

  return elapsedMs
}

export function formatPlaceholderElapsed(elapsedMs: number, t: Translate): string {
  const safeElapsedMs = Math.max(0, Math.floor(elapsedMs))
  const totalSeconds = Math.round(safeElapsedMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60)

  if (days > 0) return t('message.tools.placeholder.elapsed.days', { days, hours, minutes, seconds })
  if (hours > 0) return t('message.tools.placeholder.elapsed.hours', { hours, minutes, seconds })
  if (minutes > 0) return t('message.tools.placeholder.elapsed.minutes', { minutes, seconds })
  return t('message.tools.placeholder.elapsed.seconds', { seconds })
}

const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({
  isProcessing,
  status = 'preparing',
  stalled = false,
  stalledReason
}) => {
  const { t } = useTranslation()

  if (isProcessing) {
    if (stalled) {
      const stallKey = stalledReason ? STALL_LABEL_KEYS[stalledReason] : undefined
      const stallLabel = stallKey ? t(stallKey) : t('message.tools.placeholder.stalled')
      return (
        <div
          className="flex min-h-7 select-none flex-row items-center gap-1.5 py-0.5 text-[13px] text-amber-500 leading-5"
          data-testid="message-status-placeholder-stalled">
          <span data-testid="message-status-text-stalled">{stallLabel}</span>
          <BeatLoader color="currentColor" size={4} speedMultiplier={0.8} />
        </div>
      )
    }
    return (
      <div
        className="flex min-h-7 select-none flex-row items-center gap-1.5 py-0.5 text-[13px] text-foreground-tertiary leading-5"
        data-testid="message-status-placeholder">
        <span data-testid="message-status-text">{t(PLACEHOLDER_LABEL_KEYS[status])}</span>
        <BeatLoader color="currentColor" size={4} speedMultiplier={0.8} />
      </div>
    )
  }
  return null
}
export default React.memo(PlaceholderBlock)
