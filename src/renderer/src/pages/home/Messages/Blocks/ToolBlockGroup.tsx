import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useAppSelector } from '@renderer/store'
import type { ToolPermissionEntry } from '@renderer/store/toolPermissions'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { isToolPending } from '@renderer/utils/userConfirmation'
import { Collapse, type CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useToolApproval } from '../Tools/hooks/useToolApproval'
import { getEffectiveStatus, type ToolStatus } from '../Tools/MessageAgentTools/GenericTools'
import MessageTools from '../Tools/MessageTools'
import ToolApprovalActionsComponent from '../Tools/ToolApprovalActions'
import ToolHeader from '../Tools/ToolHeader'
import type { ToolRenderItem, ToolResponseLike } from '../Tools/toolResponse'
import { buildToolRenderItemFromBlock } from '../Tools/toolResponse'
import BlockErrorFallback from './BlockErrorFallback'

// ============ Styled Components ============

const Container = styled.div`
  width: fit-content;
  max-width: 100%;

  /* Only style the direct group collapse, not nested tool collapses */
  > .ant-collapse {
    background: transparent;
    border: none;

    > .ant-collapse-item {
      border: none !important;

      > .ant-collapse-header {
        padding: 8px 12px !important;
        background: var(--color-background);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem !important;
        display: flex;
        align-items: center;

        .ant-collapse-expand-icon {
          padding: 0 !important;
          margin-left: 8px;
          height: auto !important;
        }
      }

      > .ant-collapse-content {
        border: none;
        background: transparent;

        > .ant-collapse-content-box {
          padding: 4px 0 0 0 !important;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
      }
    }
  }
`

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;

  .tool-icon {
    color: var(--color-primary);
  }

  .tool-count {
    color: var(--color-text-1);
  }
`

const ScrollableToolList = styled.div`
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const ToolItem = styled.div<{ $isCompleted: boolean }>`
  opacity: ${(props) => (props.$isCompleted ? 0.7 : 1)};
  transition: opacity 0.2s;
`

const AnimatedHeaderWrapper = styled(motion.div)`
  display: inline-block;
`

const HeaderWithActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  justify-content: space-between;
`

// ============ Types & Helpers ============

interface Props {
  blocks?: ToolMessageBlock[]
  items?: ToolRenderItem[]
}

function isCompletedStatus(status: ToolResponseLike['status'] | undefined): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

function normalizeItems(props: Props): ToolRenderItem[] {
  if (props.items?.length) return props.items
  if (!props.blocks?.length) return []
  return props.blocks.map(buildToolRenderItemFromBlock).filter((item): item is ToolRenderItem => item !== null)
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
    <HeaderWithActions>
      <ToolHeader toolResponse={toolResponse} variant="collapse-label" status={effectiveStatus} />
      {(approval.isWaiting || approval.isExecuting) && <ToolApprovalActionsComponent {...approval} compact />}
    </HeaderWithActions>
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
      <GroupHeader>
        <Wrench size={14} className="tool-icon" />
        <span className="tool-count">{t('message.tools.groupHeader', { count: items.length })}</span>
      </GroupHeader>
    )
  }

  // Find items actually waiting for approval (using effective status)
  const waitingItems = items.filter((item) => getItemEffectiveStatus(item, agentPermissions) === 'waiting')

  // Prioritize showing waiting items that need approval
  const lastWaitingItem = waitingItems[waitingItems.length - 1]
  if (lastWaitingItem) {
    return (
      <AnimatePresence mode="wait">
        <AnimatedHeaderWrapper
          key={lastWaitingItem.id}
          variants={headerVariants}
          initial="enter"
          animate="center"
          exit="exit">
          <WaitingToolHeader item={lastWaitingItem} />
        </AnimatedHeaderWrapper>
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
        <AnimatedHeaderWrapper
          key={lastRunningItem.id}
          variants={headerVariants}
          initial="enter"
          animate="center"
          exit="exit">
          <ToolHeader toolResponse={lastRunningItem.toolResponse} variant="collapse-label" />
        </AnimatedHeaderWrapper>
      </AnimatePresence>
    )
  }

  // Fallback
  return (
    <GroupHeader>
      <Wrench size={14} className="tool-icon" />
      <span className="tool-count">{t('message.tools.groupHeader', { count: items.length })}</span>
    </GroupHeader>
  )
})
GroupHeaderContent.displayName = 'GroupHeaderContent'

// Component for tool list content with auto-scroll
interface ToolListContentProps {
  items: ToolRenderItem[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}

const ToolListContent = React.memo(({ items, scrollRef }: ToolListContentProps) => (
  <ScrollableToolList ref={scrollRef}>
    {items.map((item) => {
      const status = item.toolResponse.status
      const isCompleted = isCompletedStatus(status)
      return (
        <ToolItem key={item.id} data-block-id={item.id} $isCompleted={isCompleted}>
          <ErrorBoundary fallbackComponent={BlockErrorFallback}>
            <MessageTools toolResponse={item.toolResponse} />
          </ErrorBoundary>
        </ToolItem>
      )
    })}
  </ScrollableToolList>
))
ToolListContent.displayName = 'ToolListContent'

// ============ Main Component ============

const ToolBlockGroup: React.FC<Props> = (props) => {
  const toolItems = useMemo(() => normalizeItems(props), [props])
  const [activeKey, setActiveKey] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const userExpandedRef = useRef(false)

  const allCompleted = useMemo(() => {
    return toolItems.every((item) => isCompletedStatus(item.toolResponse.status))
  }, [toolItems])

  const currentRunningBlock = useMemo(() => {
    return toolItems.find((item) => !isCompletedStatus(item.toolResponse.status))
  }, [toolItems])

  useEffect(() => {
    if (activeKey.includes('tool-group') && currentRunningBlock && scrollRef.current) {
      const element = scrollRef.current.querySelector(`[data-block-id="${currentRunningBlock.id}"]`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeKey, currentRunningBlock])

  const handleChange = (keys: string | string[]) => {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    const isExpanding = keyArray.includes('tool-group')
    userExpandedRef.current = isExpanding
    setActiveKey(keyArray)
  }

  const collapseItems: CollapseProps['items'] = useMemo(() => {
    return [
      {
        key: 'tool-group',
        label: <GroupHeaderContent items={toolItems} allCompleted={allCompleted} />,
        children: <ToolListContent items={toolItems} scrollRef={scrollRef} />
      }
    ]
  }, [toolItems, allCompleted])

  return (
    <Container>
      <Collapse
        ghost
        size="small"
        expandIconPosition="end"
        activeKey={activeKey}
        onChange={handleChange}
        items={collapseItems}
      />
    </Container>
  )
}

export default React.memo(ToolBlockGroup)
