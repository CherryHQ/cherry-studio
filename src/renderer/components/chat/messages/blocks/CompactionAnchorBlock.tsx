import { Loader2 } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import type { CompactionAnchorData } from '@shared/ai/compaction'

interface Props {
  /** Absent for anchors persisted before the part carried a payload. */
  data?: CompactionAnchorData
}

/**
 * Timeline marker for a compacted stretch of conversation.
 *
 * Two states share one part id, so the same element goes from spinner to
 * settled rule instead of stacking two anchors:
 * - `compacting` — a summarize round-trip is in flight. Turn-start compaction
 *   runs BEFORE the model stream opens, so without this the turn looks stalled.
 * - `done` — the dashed rule, optionally annotated with what the fold saved.
 *
 * A payload-less part (older messages, or the agent-session anchor before it
 * carried status) renders the settled rule — the historical behaviour.
 */
const CompactionAnchorBlock: React.FC<Props> = ({ data }) => {
  const { t } = useTranslation()

  // A fold that changed nothing settles as `skipped`: clear the spinner, but draw no
  // marker — an untouched history must not read as a completed compaction (#17837).
  if (data?.status === 'skipped') return null

  /** Tokens the fold reclaimed, when the path could measure both ends. */
  const saved =
    data?.preTokens !== undefined && data?.postTokens !== undefined && data.preTokens > data.postTokens
      ? data.preTokens - data.postTokens
      : undefined

  // An in-loop fold happens between tool calls of one continuous loop, so it
  // renders as a row INSIDE the process group (like a tool entry) rather than a
  // full-width rule that would cut the group in half.
  if (data?.phase === 'in-loop') {
    const compacting = data.status === 'compacting'
    return (
      <div
        className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground"
        role={compacting ? 'status' : undefined}
        aria-live={compacting ? 'polite' : undefined}>
        {compacting ? (
          <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-border" aria-hidden />
        )}
        <span>
          {compacting
            ? t('chat.compaction.compacting')
            : saved === undefined
              ? t('chat.compaction.compacted_plain')
              : t('chat.compaction.compacted', { count: saved })}
        </span>
      </div>
    )
  }

  if (data?.status === 'compacting') {
    return (
      <div
        className="my-3 flex w-full items-center gap-2 text-xs text-muted-foreground"
        role="status"
        aria-live="polite">
        <span className="h-px min-w-6 flex-1 border-t border-dashed border-border-subtle" aria-hidden />
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
        <span className="shrink-0">{t('chat.compaction.compacting')}</span>
        <span className="h-px min-w-6 flex-1 border-t border-dashed border-border-subtle" aria-hidden />
      </div>
    )
  }

  return (
    <div className="my-3 flex w-full items-center gap-3 text-muted-foreground" role="separator">
      <span className="h-px min-w-6 flex-1 border-t border-dashed border-border-subtle" aria-hidden />
      {saved === undefined ? (
        <span className="size-1.5 shrink-0 rounded-full bg-border" aria-hidden />
      ) : (
        <span className="shrink-0 text-xs">{t('chat.compaction.compacted', { count: saved })}</span>
      )}
      <span className="h-px min-w-6 flex-1 border-t border-dashed border-border-subtle" aria-hidden />
    </div>
  )
}

export default React.memo(CompactionAnchorBlock)
