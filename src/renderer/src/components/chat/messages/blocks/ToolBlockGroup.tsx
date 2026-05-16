import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import type { CherryMessagePart } from '@shared/data/types/message'
import { ChevronDown, Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getEffectiveStatus, type ToolStatus } from '../tools/agent/GenericTools'
import { useToolApproval } from '../tools/hooks/useToolApproval'
import MessageTools from '../tools/MessageTools'
import ToolApprovalActionsComponent from '../tools/ToolApprovalActions'
import ToolHeader from '../tools/ToolHeader'
import { isToolPartAwaitingApproval, type ToolRenderItem, type ToolResponseLike } from '../tools/toolResponse'
import BlockErrorFallback from './BlockErrorFallback'
import { usePartsMap } from './MessagePartsContext'

// ============ Types & Helpers ============

interface Props {
  items: ToolRenderItem[]
}

function isCompletedStatus(status: ToolResponseLike['status'] | undefined): boolean {
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

// Animation variants for smooth header transitions
const headerVariants = {
  enter: { x: 20, opacity: 0 },
  center: { x: 0, opacity: 1, transition: { duration: 0.2, ease: 'easeOut' as const } },
  exit: { x: -20, opacity: 0, transition: { duration: 0.15 } }
}

// ============ Sub-Components ============

// Component for rendering a block with approval actions
interface WaitingToolHeaderProps {
  item: ToolRenderItem
}

const WaitingToolHeader = React.memo(({ item }: WaitingToolHeaderProps) => {
  const toolResponse = item.toolResponse
  const approval = useToolApproval(toolResponse)
  const effectiveStatus = getEffectiveStatus(toolResponse?.status, approval.isWaiting)

  return (
    <div className="flex w-full items-center justify-between gap-2">
      <ToolHeader toolResponse={toolResponse} variant="collapse-label" status={effectiveStatus} />
      {(approval.isWaiting || approval.isExecuting) && <ToolApprovalActionsComponent {...approval} compact />}
    </div>
  )
})
WaitingToolHeader.displayName = 'WaitingToolHeader'

interface GroupHeaderContentProps {
  items: ToolRenderItem[]
  allCompleted: boolean
}

const GroupHeaderContent = React.memo(({ items, allCompleted }: GroupHeaderContentProps) => {
  const { t } = useTranslation()
  const partsMap = usePartsMap()

  if (allCompleted) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <div className="flex h-5 w-4 shrink-0 items-center justify-start text-foreground-muted transition-colors duration-150 group-hover/tool-group:text-foreground-secondary">
          <Wrench size={14} />
        </div>
        <span className="truncate font-normal text-foreground-secondary transition-colors duration-150 group-hover/tool-group:text-foreground">
          {t('message.tools.groupHeader', { count: items.length })}
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
      <AnimatePresence mode="wait">
        <motion.div
          className="inline-block"
          key={lastWaitingItem.id}
          variants={headerVariants}
          initial="enter"
          animate="center"
          exit="exit">
          <WaitingToolHeader item={lastWaitingItem} />
        </motion.div>
      </AnimatePresence>
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
    return (
      <AnimatePresence mode="wait">
        <motion.div
          className="inline-block"
          key={lastRunningItem.id}
          variants={headerVariants}
          initial="enter"
          animate="center"
          exit="exit">
          <ToolHeader toolResponse={lastRunningItem.toolResponse} variant="collapse-label" />
        </motion.div>
      </AnimatePresence>
    )
  }

  // Fallback
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <div className="flex h-5 w-8 shrink-0 items-center justify-start text-foreground-muted transition-colors duration-150 group-hover/tool-group:text-foreground-secondary">
        <Wrench size={14} />
      </div>
      <span className="truncate font-normal text-foreground-secondary transition-colors duration-150 group-hover/tool-group:text-foreground">
        {t('message.tools.groupHeader', { count: items.length })}
      </span>
    </div>
  )
})
GroupHeaderContent.displayName = 'GroupHeaderContent'

// Component for tool list content with auto-scroll
interface ToolListContentProps {
  items: ToolRenderItem[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}

const ToolListContent = React.memo(({ items, scrollRef }: ToolListContentProps) => (
  <div ref={scrollRef} className="flex w-full flex-col gap-2.5">
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
ToolListContent.displayName = 'ToolListContent'

// ============ Main Component ============

const ToolBlockGroup: React.FC<Props> = ({ items }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const contentId = useId()
  const scrollRef = useRef<HTMLDivElement>(null)

  const allCompleted = useMemo(() => {
    return items.every((item) => isCompletedStatus(item.toolResponse.status))
  }, [items])

  const currentRunningBlock = useMemo(() => {
    return items.find((item) => !isCompletedStatus(item.toolResponse.status))
  }, [items])

  useEffect(() => {
    if (isExpanded && currentRunningBlock && scrollRef.current) {
      const element = scrollRef.current.querySelector(`[data-block-id="${currentRunningBlock.id}"]`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isExpanded, currentRunningBlock])

  return (
    <div className={`group/tool-group max-w-full ${isExpanded ? 'w-full' : 'w-fit'}`}>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="flex w-full items-center justify-start gap-1.5 rounded border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
        onClick={() => setIsExpanded((expanded) => !expanded)}>
        <GroupHeaderContent items={items} allCompleted={allCompleted} />
        <ChevronDown
          size={16}
          className={`shrink-0 text-foreground-muted opacity-0 transition-all duration-150 group-hover/tool-group:opacity-100 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>
      {isExpanded && (
        <div id={contentId} className="mt-3.5">
          <ToolListContent items={items} scrollRef={scrollRef} />
        </div>
      )}
    </div>
  )
}

export default React.memo(ToolBlockGroup)
