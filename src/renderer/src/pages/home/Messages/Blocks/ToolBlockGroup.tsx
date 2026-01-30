import type { MCPToolResponseStatus } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { Collapse, type CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useToolApproval } from '../Tools/hooks/useToolApproval'
import MessageTools from '../Tools/MessageTools'
import ToolApprovalActionsComponent from '../Tools/ToolApprovalActions'
import ToolHeader from '../Tools/ToolHeader'

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
  blocks: ToolMessageBlock[]
}

function isCompletedStatus(status: MCPToolResponseStatus | undefined): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

function isWaitingStatus(status: MCPToolResponseStatus | undefined): boolean {
  return status === 'pending'
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
  block: ToolMessageBlock
}

const WaitingToolHeader = React.memo(({ block }: WaitingToolHeaderProps) => {
  const approval = useToolApproval(block)

  return (
    <HeaderWithActions>
      <ToolHeader block={block} variant="collapse-label" showStatus={false} />
      {(approval.isWaiting || approval.isExecuting) && <ToolApprovalActionsComponent {...approval} compact />}
    </HeaderWithActions>
  )
})
WaitingToolHeader.displayName = 'WaitingToolHeader'

interface GroupHeaderContentProps {
  blocks: ToolMessageBlock[]
  allCompleted: boolean
}

const GroupHeaderContent = React.memo(({ blocks, allCompleted }: GroupHeaderContentProps) => {
  const { t } = useTranslation()

  if (allCompleted) {
    return (
      <GroupHeader>
        <Wrench size={14} className="tool-icon" />
        <span className="tool-count">{t('message.tools.groupHeader', { count: blocks.length })}</span>
      </GroupHeader>
    )
  }

  // Find blocks needing approval (pending status)
  const waitingBlocks = blocks.filter((block) => {
    const status = block.metadata?.rawMcpToolResponse?.status
    return isWaitingStatus(status)
  })

  // Prioritize showing waiting blocks that need approval
  const lastWaitingBlock = waitingBlocks[waitingBlocks.length - 1]
  if (lastWaitingBlock) {
    return (
      <AnimatePresence mode="wait">
        <AnimatedHeaderWrapper
          key={lastWaitingBlock.id}
          variants={headerVariants}
          initial="enter"
          animate="center"
          exit="exit">
          <WaitingToolHeader block={lastWaitingBlock} />
        </AnimatedHeaderWrapper>
      </AnimatePresence>
    )
  }

  const runningBlocks = blocks.filter((block) => {
    const status = block.metadata?.rawMcpToolResponse?.status
    return !isCompletedStatus(status) && !isWaitingStatus(status)
  })

  // Get the last running block (most recent) and render with animation
  const lastRunningBlock = runningBlocks[runningBlocks.length - 1]
  if (lastRunningBlock) {
    return (
      <AnimatePresence mode="wait">
        <AnimatedHeaderWrapper
          key={lastRunningBlock.id}
          variants={headerVariants}
          initial="enter"
          animate="center"
          exit="exit">
          <ToolHeader block={lastRunningBlock} variant="collapse-label" />
        </AnimatedHeaderWrapper>
      </AnimatePresence>
    )
  }

  // Fallback
  return (
    <GroupHeader>
      <Wrench size={14} className="tool-icon" />
      <span className="tool-count">{t('message.tools.groupHeader', { count: blocks.length })}</span>
    </GroupHeader>
  )
})
GroupHeaderContent.displayName = 'GroupHeaderContent'

// Component for tool list content with auto-scroll
interface ToolListContentProps {
  blocks: ToolMessageBlock[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}

const ToolListContent = React.memo(({ blocks, scrollRef }: ToolListContentProps) => (
  <ScrollableToolList ref={scrollRef}>
    {blocks.map((block) => {
      const status = block.metadata?.rawMcpToolResponse?.status
      const isCompleted = isCompletedStatus(status)
      return (
        <ToolItem key={block.id} data-block-id={block.id} $isCompleted={isCompleted}>
          <MessageTools block={block} />
        </ToolItem>
      )
    })}
  </ScrollableToolList>
))
ToolListContent.displayName = 'ToolListContent'

// ============ Main Component ============

const ToolBlockGroup: React.FC<Props> = ({ blocks }) => {
  const [activeKey, setActiveKey] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const userExpandedRef = useRef(false)

  const allCompleted = useMemo(() => {
    return blocks.every((block) => {
      const status = block.metadata?.rawMcpToolResponse?.status
      return isCompletedStatus(status)
    })
  }, [blocks])

  const currentRunningBlock = useMemo(() => {
    return blocks.find((block) => {
      const status = block.metadata?.rawMcpToolResponse?.status
      return !isCompletedStatus(status)
    })
  }, [blocks])

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

  const items: CollapseProps['items'] = useMemo(() => {
    return [
      {
        key: 'tool-group',
        label: <GroupHeaderContent blocks={blocks} allCompleted={allCompleted} />,
        children: <ToolListContent blocks={blocks} scrollRef={scrollRef} />
      }
    ]
  }, [blocks, allCompleted])

  return (
    <Container>
      <Collapse
        ghost
        size="small"
        expandIconPosition="end"
        activeKey={activeKey}
        onChange={handleChange}
        items={items}
      />
    </Container>
  )
}

export default React.memo(ToolBlockGroup)
