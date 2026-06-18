import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import type { CherryMessagePart } from '@shared/data/types/message'
import { Brain } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { getEffectiveStatus, type ToolStatus } from '../tools/agent/GenericTools'
import MessageTools from '../tools/MessageTools'
import ToolHeader from '../tools/ToolHeader'
import { isToolPartAwaitingApproval, type ToolRenderItem, type ToolResponseLike } from '../tools/toolResponse'
import BlockErrorFallback from './BlockErrorFallback'
import { usePartsMap } from './MessagePartsContext'

// ============ Types & Helpers ============

function isToolGroupItemCompleted(status: ToolResponseLike['status'] | undefined): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

// Calculate actual waiting state for a tool item (not depending on hooks).
// AI-SDK-v6 ToolUIPart state (`approval-requested`) is the sole source of truth.
function getItemIsWaiting(item: ToolRenderItem, partsMap: Record<string, CherryMessagePart[]> | null): boolean {
  if (item.toolResponse.status !== 'pending') return false
  return isToolPartAwaitingApproval(partsMap, item.toolResponse.toolCallId)
}

// Get effective UI status for an item
function getItemEffectiveStatus(
  item: ToolRenderItem,
  partsMap: Record<string, CherryMessagePart[]> | null
): ToolStatus {
  const isWaiting = getItemIsWaiting(item, partsMap)
  return getEffectiveStatus(item.toolResponse?.status, isWaiting)
}

// ============ Sub-Components ============

interface ToolBlockGroupHeaderContentProps {
  items: ToolRenderItem[]
  activityLabel?: React.ReactNode
  summary?: React.ReactNode
  isLiveProgress?: boolean
  showLatestWhenComplete?: boolean
}

export const ToolBlockGroupHeaderContent = React.memo(
  ({ items, activityLabel, summary, isLiveProgress, showLatestWhenComplete }: ToolBlockGroupHeaderContentProps) => {
    const { t } = useTranslation()
    const partsMap = usePartsMap()
    const allCompleted = items.every((item) => isToolGroupItemCompleted(item.toolResponse.status))
    const fallbackLabel = summary ?? t('message.tools.groupHeader', { count: items.length })

    if (allCompleted && !showLatestWhenComplete) {
      return (
        <div className="flex items-center text-[13px]">
          <span className="whitespace-nowrap font-normal text-foreground-secondary transition-colors duration-150 group-hover/completed-tool-history:text-foreground group-hover/tool-group:text-foreground">
            {fallbackLabel}
          </span>
        </div>
      )
    }

    if (activityLabel) {
      return (
        <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <span
            className={['inline-flex shrink-0 items-center text-foreground-muted', isLiveProgress && 'animate-pulse']
              .filter(Boolean)
              .join(' ')}>
            <Brain size={14} />
          </span>
          <span className="truncate font-normal text-foreground-secondary transition-colors duration-150 group-hover/completed-tool-history:text-foreground group-hover/tool-group:text-foreground">
            {activityLabel}
          </span>
        </div>
      )
    }

    // Find items actually waiting for approval (using effective status)
    const waitingItems = items.filter((item) => getItemEffectiveStatus(item, partsMap) === 'waiting')

    // Prioritize showing waiting items that need approval
    const lastWaitingItem = waitingItems[waitingItems.length - 1]
    if (lastWaitingItem) {
      return (
        <div className="min-w-0 max-w-full overflow-hidden" key={lastWaitingItem.id}>
          <ToolHeader toolResponse={lastWaitingItem.toolResponse} variant="collapse-label" status="waiting" />
        </div>
      )
    }

    // Find running items (invoking or streaming)
    const runningItems = items.filter((item) => {
      const status = getItemEffectiveStatus(item, partsMap)
      return status === 'invoking' || status === 'streaming'
    })

    // Get the last running item (most recent) and render with animation
    const lastRunningItem = runningItems[runningItems.length - 1]
    if (lastRunningItem) {
      const lastRunningStatus = getItemEffectiveStatus(lastRunningItem, partsMap)
      return (
        <div className="min-w-0 max-w-full overflow-hidden" key={lastRunningItem.id}>
          <ToolHeader toolResponse={lastRunningItem.toolResponse} variant="collapse-label" status={lastRunningStatus} />
        </div>
      )
    }

    const latestItem = showLatestWhenComplete ? items.at(-1) : undefined
    if (latestItem) {
      return (
        <div className="min-w-0 max-w-full overflow-hidden" key={latestItem.id}>
          <ToolHeader
            toolResponse={latestItem.toolResponse}
            variant="collapse-label"
            status={isLiveProgress ? 'invoking' : getItemEffectiveStatus(latestItem, partsMap)}
          />
        </div>
      )
    }

    // Fallback
    return (
      <div className="flex min-w-0 items-center text-[13px]">
        <span className="truncate font-normal text-foreground-secondary transition-colors duration-150 group-hover/completed-tool-history:text-foreground group-hover/tool-group:text-foreground">
          {fallbackLabel}
        </span>
      </div>
    )
  }
)
ToolBlockGroupHeaderContent.displayName = 'ToolBlockGroupHeaderContent'

// Component for tool list content with auto-scroll
interface ToolBlockGroupContentProps {
  items: ToolRenderItem[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
}

export const ToolBlockGroupContent = React.memo(({ items, scrollRef }: ToolBlockGroupContentProps) => (
  <div ref={scrollRef} className="flex w-full flex-col gap-2">
    {items.map((item) => {
      return (
        <div key={item.id} data-block-id={item.id} className="w-full">
          <ErrorBoundary fallbackComponent={BlockErrorFallback}>
            <MessageTools toolResponse={item.toolResponse} />
          </ErrorBoundary>
        </div>
      )
    })}
  </div>
))
ToolBlockGroupContent.displayName = 'ToolBlockGroupContent'
