import { Button } from '@cherrystudio/ui'
import type { ToolRenderItem } from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { ChevronDown } from 'lucide-react'
import React, { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatPlaceholderElapsed } from './PlaceholderBlock'
import { ToolBlockGroupHeaderContent } from './ToolBlockGroup'
import { useScrollAnchor } from './useScrollAnchor'

interface Props {
  children: React.ReactNode
  hasContent: boolean
  hasError: boolean
  hasReasoning: boolean
  message: MessageListItem
  toolCount: number
  toolItems: ToolRenderItem[]
}

/** Terminal-only process history. Its disclosure state never crosses the live boundary. */
const CompletedProcessHistory = React.memo(function CompletedProcessHistory({
  children,
  hasContent,
  hasError,
  hasReasoning,
  message,
  toolCount,
  toolItems
}: Props) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const contentId = useId()
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()
  const elapsedMs = useMemo(() => {
    if (typeof message.stats?.timeCompletionMs === 'number') return message.stats.timeCompletionMs
    if (!message.updatedAt) return undefined

    const startedAt = Date.parse(message.createdAt)
    const finishedAt = Date.parse(message.updatedAt)
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return undefined
    return finishedAt - startedAt
  }, [message.createdAt, message.stats?.timeCompletionMs, message.updatedAt])
  const elapsedText = elapsedMs === undefined ? undefined : formatPlaceholderElapsed(elapsedMs, t)
  const toolCountText = t('message.tools.groupHeader', { count: toolCount })
  const processStatusText = t(hasError ? 'message.tools.error' : 'message.tools.processed')
  const summary =
    toolCount > 0 ? (
      hasError || elapsedText ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <span>{processStatusText}</span>
          <span aria-hidden="true" className="text-muted-foreground/40">
            ·
          </span>
          <span>{toolCountText}</span>
        </span>
      ) : (
        toolCountText
      )
    ) : hasError ? (
      processStatusText
    ) : hasReasoning ? (
      t('common.reasoning_content')
    ) : (
      processStatusText
    )

  if (!hasContent) return null

  return (
    <div ref={anchorRef} className="group/completed-tool-history w-full max-w-full">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="h-auto min-h-7 w-full justify-start gap-1.5 rounded bg-transparent px-0 py-0.5 text-left shadow-none hover:bg-transparent focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-0"
        onClick={() => withScrollAnchor(() => setIsExpanded((expanded) => !expanded))}>
        <div className="min-w-0 flex-1 overflow-hidden">
          <ToolBlockGroupHeaderContent items={toolItems} elapsedText={elapsedText} summary={summary} preferSummary />
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-foreground-muted opacity-60 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </Button>
      <div aria-hidden="true" data-testid="tool-history-divider" className="my-1.5 h-px w-full bg-border-subtle" />
      {isExpanded && (
        <div
          id={contentId}
          data-testid="tool-history-content"
          className="flex w-full flex-col gap-2 [&>.block-wrapper+.block-wrapper]:mt-0! [&>.block-wrapper:empty]:hidden [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0!">
          {children}
        </div>
      )}
    </div>
  )
})

export default CompletedProcessHistory
