import { Button } from '@cherrystudio/ui'
import type { ToolRenderItem } from '@renderer/components/chat/messages/tools/toolResponse'
import { ChevronDown } from 'lucide-react'
import React, { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { useRequestScrollFollowRecovery } from './ScrollOwnershipContext'
import ThinkingEffect from './ThinkingEffect'
import { ToolBlockGroupHeaderContent } from './ToolBlockGroup'
import { useProcessRunAutoScroll } from './useProcessRunAutoScroll'
import { useScrollAnchor } from './useScrollAnchor'

interface Props {
  id: string
  allToolsTerminal: boolean
  hasReasoning: boolean
  headerToolItems: ToolRenderItem[]
  hasToolError: boolean
  isExpanded: boolean
  isLive: boolean
  isReasoningTail: boolean
  onExpandedChange: (expanded: boolean) => void
  renderContent: (onBeforeExpand: () => void, onAfterCollapse: () => void) => React.ReactNode
  toolCount: number
}

/** A single transparent disclosure for one uninterrupted live process run. */
const LiveProcessRun = React.memo(function LiveProcessRun({
  id,
  allToolsTerminal,
  hasReasoning,
  headerToolItems,
  hasToolError,
  isExpanded,
  isLive,
  isReasoningTail,
  onExpandedChange,
  renderContent,
  toolCount
}: Props) {
  const { t } = useTranslation()
  const contentId = useId()
  const { anchorRef, withScrollAnchor } = useScrollAnchor<HTMLDivElement>()
  const requestFollowRecovery = useRequestScrollFollowRecovery()
  const { contentRef, pauseForInteraction, viewportRef } = useProcessRunAutoScroll(requestFollowRecovery)
  const summary = toolCount > 0 ? t('message.tools.groupHeader', { count: toolCount }) : t('common.reasoning_content')
  const activityLabel = hasToolError
    ? undefined
    : isLive && isReasoningTail
      ? t('message.tools.thinkingHeader')
      : isLive && toolCount > 0 && allToolsTerminal && !hasToolError
        ? t('message.tools.runningHeader')
        : undefined

  const toggleExpanded = () => {
    const nextExpanded = !isExpanded
    pauseForInteraction()
    withScrollAnchor(() => onExpandedChange(nextExpanded))
    if (!nextExpanded) requestFollowRecovery()
  }

  return (
    <div
      ref={anchorRef}
      className="group/live-process w-full max-w-full"
      data-testid="live-process-run"
      data-live-process-run={id}
      data-run-id={id}
      data-run-phase={isLive ? 'active' : 'sealed'}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        data-testid="live-process-run-trigger"
        className="group/tool-group h-auto min-h-7 w-full justify-start gap-1.5 rounded bg-transparent px-0 py-0.5 text-left shadow-none hover:bg-transparent focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-0"
        onClick={toggleExpanded}>
        <div className="min-w-0 flex-1 overflow-hidden">
          {toolCount > 0 ? (
            <ToolBlockGroupHeaderContent
              items={headerToolItems}
              activityLabel={activityLabel}
              summary={summary}
              isLiveProgress={isLive}
              preferSummary={!isLive && !hasToolError}
              showLatestWhenComplete={isLive || hasToolError}
            />
          ) : (
            <ThinkingEffect
              thinkingTimeText={isLive ? t('message.tools.thinkingHeader') : t('common.reasoning_content')}
            />
          )}
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-foreground-muted opacity-60 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </Button>
      {isExpanded && (hasReasoning || toolCount > 0) && (
        <div
          ref={viewportRef}
          id={contentId}
          data-testid="live-process-run-content"
          className="mt-1 ml-1 max-h-[min(30vh,180px)] overflow-y-auto overscroll-contain border-border-muted border-l pl-3 [scrollbar-width:thin]"
          onPointerDownCapture={pauseForInteraction}>
          <div ref={contentRef} className="flex min-w-0 flex-col gap-2 pb-1">
            {renderContent(pauseForInteraction, requestFollowRecovery)}
          </div>
        </div>
      )}
    </div>
  )
})

export default LiveProcessRun
