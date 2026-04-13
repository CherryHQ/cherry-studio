import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useAppSelector } from '@renderer/store'
import type { ToolPermissionEntry } from '@renderer/store/toolPermissions'
import { isToolPending } from '@renderer/utils/userConfirmation'
import { Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useToolApproval } from '../Tools/hooks/useToolApproval'
import { getEffectiveStatus, type ToolStatus } from '../Tools/MessageAgentTools/GenericTools'
import MessageTools from '../Tools/MessageTools'
import ToolApprovalActionsComponent from '../Tools/ToolApprovalActions'
import ToolHeader from '../Tools/ToolHeader'
import type { ToolRenderItem, ToolResponseLike } from '../Tools/toolResponse'
import BlockErrorFallback from './BlockErrorFallback'

// ============ Types & Helpers ============

interface Props {
  items: ToolRenderItem[]
}

function isCompletedStatus(status: ToolResponseLike['status'] | undefined): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

// Calculate actual waiting state for a tool item (not depending on hooks)
function getItemIsWaiting(item: ToolRenderItem, agentPermissions: Record<string, ToolPermissionEntry>): boolean {
  const toolResponse = item.toolResponse
  if (toolResponse.status !== 'pending') return false

  const tool = toolResponse.tool
  if (tool?.type === 'mcp') {
    // MCP tools: check the global confirmation queue
    return isToolPending(toolResponse.id)
  } else {
    // Agent tools: check Redux store for pending permission
    const permission = Object.values(agentPermissions).find((p) => p.toolCallId === toolResponse.toolCallId)
    return permission?.status === 'pending'
  }
}

// Get effective UI status for an item
function getItemEffectiveStatus(
  item: ToolRenderItem,
  agentPermissions: Record<string, ToolPermissionEntry>
): ToolStatus {
  const toolResponse = item.toolResponse
  const isWaiting = getItemIsWaiting(item, agentPermissions)
  return getEffectiveStatus(toolResponse?.status, isWaiting)
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
  const agentPermissions = useAppSelector((state) => state.toolPermissions.requests)

  if (allCompleted) {
    return (
      <div className="flex items-center gap-2 font-medium text-[13px]">
        <Wrench size={14} className="text-(--color-primary)" />
        <span className="text-(--color-text-1)">{t('message.tools.groupHeader', { count: items.length })}</span>
      </div>
    )
  }

  // Find items actually waiting for approval (using effective status)
  const waitingItems = items.filter((item) => getItemEffectiveStatus(item, agentPermissions) === 'waiting')

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
    const status = getItemEffectiveStatus(item, agentPermissions)
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
    <div className="flex items-center gap-2 font-medium text-[13px]">
      <Wrench size={14} className="text-(--color-primary)" />
      <span className="text-(--color-text-1)">{t('message.tools.groupHeader', { count: items.length })}</span>
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
  <div ref={scrollRef} className="flex max-h-[300px] flex-col gap-1 overflow-y-auto">
    {items.map((item) => {
      const status = item.toolResponse.status
      const isCompleted = isCompletedStatus(status)
      return (
        <div
          key={item.id}
          data-block-id={item.id}
          className={`transition-opacity duration-200 ${isCompleted ? 'opacity-70' : 'opacity-100'}`}>
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
  const [activeKey, setActiveKey] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const userExpandedRef = useRef(false)

  const allCompleted = useMemo(() => {
    return items.every((item) => isCompletedStatus(item.toolResponse.status))
  }, [items])

  const currentRunningBlock = useMemo(() => {
    return items.find((item) => !isCompletedStatus(item.toolResponse.status))
  }, [items])

  useEffect(() => {
    if (activeKey === 'tool-group' && currentRunningBlock && scrollRef.current) {
      const element = scrollRef.current.querySelector(`[data-block-id="${currentRunningBlock.id}"]`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeKey, currentRunningBlock])

  const handleChange = (value: string) => {
    userExpandedRef.current = value === 'tool-group'
    setActiveKey(value)
  }

  return (
    <div className="w-fit max-w-full">
      <Accordion type="single" collapsible value={activeKey} onValueChange={handleChange}>
        <AccordionItem value="tool-group" className="border-0 first:border-t-0">
          <AccordionTrigger className="rounded-xl border border-(--color-border) bg-(--color-background) px-3 py-2 hover:no-underline">
            <GroupHeaderContent items={items} allCompleted={allCompleted} />
          </AccordionTrigger>
          <AccordionContent className="gap-1 pt-1 pb-0">
            <ToolListContent items={items} scrollRef={scrollRef} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

export default React.memo(ToolBlockGroup)
