import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useSharedCacheValue } from '@renderer/data/hooks/useCache'

/** Shows the attachment analysis stage, which runs before the model stream opens and would otherwise look stalled. */
export default function MessageMediaAnalysisStatus({
  messageId,
  fallback
}: {
  messageId: string
  fallback: ReactNode
}) {
  const { t } = useTranslation()
  const progress = useSharedCacheValue(`message.media_analysis.${messageId}`)
  if (!progress) return fallback

  // Frames are described in batches, so "0/n" would sit unchanged for the whole first batch.
  const counts = progress.done ? { done: progress.done, total: progress.total ?? progress.done } : undefined
  const label =
    progress.stage === 'transcribing'
      ? t('chat.media_analysis.transcribing')
      : progress.stage === 'reading_frames'
        ? counts
          ? t('chat.media_analysis.reading_frames', counts)
          : t('chat.media_analysis.reading_frames_started')
        : counts
          ? t('chat.media_analysis.describing_frames', counts)
          : t('chat.media_analysis.describing_frames_started')
  return (
    <div className="flex items-center gap-2 py-0.5 text-muted-foreground text-xs" role="status" aria-live="polite">
      <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
